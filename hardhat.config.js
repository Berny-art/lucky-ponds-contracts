require("@nomicfoundation/hardhat-toolbox");
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
			url: 'https://rpc.hyperliquid.xyz/evm',
			accounts: [process.env.PRIVATE_KEY],
			chainId: 999,
		},
	},
	etherscan: {
		apiKey: {
			'hyperevm-mainnet': 'empty',
			'hyperliquid_mainnet': 'empty'
		},
		customChains: [
			{
				network: "hyperevm-mainnet",
				chainId: 999,
				urls: {
					apiURL: "https://www.hyperscan.com/api",
					browserURL: "https://www.hyperscan.com"
				}
			},
			{
				network: "hyperliquid_mainnet",
				chainId: 999,
				urls: {
					apiURL: "https://www.hyperscan.com/api",
					browserURL: "https://www.hyperscan.com"
				}
			}
		]
	}
};
