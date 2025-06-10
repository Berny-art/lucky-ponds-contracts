require("@nomicfoundation/hardhat-toolbox");
require("hardhat-gas-reporter");
require("dotenv").config();

require("./tasks/query-ponds");
require("./tasks/simulate-tosses");
require("./tasks/emergency-refund");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 500, // Higher value for smaller bytecode
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      gas: 30000000, // Increase gas limit for testing
      blockGasLimit: 30000000,
      allowUnlimitedContractSize: true,
      accounts: {
        count: 20, // More test accounts
        accountsBalance: "10000000000000000000000", // 10,000 ETH each
      },
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    hyperliquid_testnet: {
      url: "https://rpc.hyperliquid-testnet.xyz/evm",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 998,
    },
    hyperliquid_mainnet: {
      url: "https://rpc.hyperliquid.xyz/evm",
      accounts: [process.env.PRIVATE_KEY],
      chainId: 999,
    },
    'hyperevm-mainnet': {
      url: 'https://rpc.hyperliquid.xyz/evm'
    },
  },
  etherscan: {
    apiKey: {
      'hyperevm-mainnet': 'empty'
    },
    customChains: [
      {
        network: "hyperevm-mainnet",
        chainId: 999,
        urls: {
          apiURL: "https://www.hyperscan.com/api",
          browserURL: "https://www.hyperscan.com"
        },
      },
    ],
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
    gasPrice: 20,
    showTimeSpent: true,
    excludeContracts: ["contracts/mocks/", "contracts/test/"]
  },
  mocha: {
    timeout: 120000, // 2 minutes timeout for complex tests
  },
};