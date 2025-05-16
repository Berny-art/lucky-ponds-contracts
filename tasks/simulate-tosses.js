// tasks/simulate-tosses.js
const { task } = require("hardhat/config");
const fs = require("node:fs");
const path = require("node:path");

task(
	"simulate-tosses",
	"Simulate tosses from multiple accounts into native ponds",
)
	.addParam(
		"minpond",
		"Minimum number of ponds to use per account (1-5)",
		1,
		types.int,
	)
	.addParam(
		"maxpond",
		"Maximum number of ponds to use per account (1-5)",
		3,
		types.int,
	)
	.addParam(
		"mintoss",
		"Minimum number of tosses per account per pond",
		1,
		types.int,
	)
	.addParam(
		"maxtoss",
		"Maximum number of tosses per account per pond",
		5,
		types.int,
	)
	.addParam(
		"mintossamount",
		"Minimum toss amount in ETH",
		"0.0001",
		types.string,
	)
	.addParam(
		"maxtossamount",
		"Maximum toss amount in ETH",
		"0.001",
		types.string,
	)
	.setAction(async (taskArgs, hre) => {
		const { ethers } = hre;
		console.log("🎲 Starting toss simulation...");

		// Validate parameters
		const minPonds = Math.max(1, Math.min(5, taskArgs.minpond));
		const maxPonds = Math.max(minPonds, Math.min(5, taskArgs.maxpond));
		const minTosses = Math.max(1, Math.min(20, taskArgs.mintoss));
		const maxTosses = Math.max(minTosses, Math.min(20, taskArgs.maxtoss));

		// Parse ETH amounts
		const minTossAmount = ethers.parseEther(taskArgs.mintossamount);
		const maxTossAmount = ethers.parseEther(taskArgs.maxtossamount);

		if (minTossAmount > maxTossAmount) {
			throw new Error(
				"Minimum toss amount cannot be greater than maximum toss amount",
			);
		}

		console.log("📊 Simulation parameters:");
		console.log(`- Ponds per account: ${minPonds} to ${maxPonds}`);
		console.log(`- Tosses per pond: ${minTosses} to ${maxTosses}`);
		console.log(
			`- Toss amount range: ${ethers.formatEther(
				minTossAmount,
			)} ETH to ${ethers.formatEther(maxTossAmount)} ETH`,
		);

		// Get network information
		const network = await ethers.provider.getNetwork();
		const networkName = network.name;
		const isTestnet =
			networkName.includes("testnet") || networkName === "hyperliquid_testnet";
		const configPrefix = isTestnet ? "TESTNET" : "MAINNET";

		console.log(
			`🌐 Network: ${networkName} (${isTestnet ? "🧪 Testnet" : "🔴 Mainnet"})`,
		);

		// Load contract addresses from environment
		const pondCoreAddress = process.env[`${configPrefix}_POND_CORE_ADDRESS`];
		if (!pondCoreAddress || !ethers.isAddress(pondCoreAddress)) {
			throw new Error(
				`❌ Missing or invalid ${configPrefix}_POND_CORE_ADDRESS`,
			);
		}

		console.log(`🌟 PondCore: ${pondCoreAddress}`);

		// Load simulation accounts
		const accountsPath = path.join(
			__dirname,
			"../scripts/simulation-accounts.json",
		);
		if (!fs.existsSync(accountsPath)) {
			throw new Error(
				"❌ simulation-accounts.json not found. Please make sure it exists in the scripts directory.",
			);
		}

		const accounts = JSON.parse(fs.readFileSync(accountsPath, "utf8"));
		console.log(`👥 Loaded ${accounts.length} simulation accounts`);

		// Connect to PondCore
		const pondCore = await ethers.getContractAt("PondCore", pondCoreAddress);

		// Get standard pond types
		console.log("🔍 Getting standard pond types...");
		const standardTypes = await pondCore.getStandardPondTypes();
		const standardPonds = [
			{ name: "Five-Min", typeHash: standardTypes[0] },
			{ name: "Hourly", typeHash: standardTypes[1] },
			{ name: "Daily", typeHash: standardTypes[2] },
			{ name: "Weekly", typeHash: standardTypes[3] },
			{ name: "Monthly", typeHash: standardTypes[4] },
		];

		// Check which ponds exist and are active
		const activePonds = [];
		console.log("🔍 Checking which ponds are active...");

		for (const pond of standardPonds) {
			try {
				const pondStatus = await pondCore.getPondStatus(pond.typeHash);
				const isActive = Number(pondStatus[7]) > 0; // timeUntilEnd > 0

				if (isActive) {
					console.log(`✅ ${pond.name} pond is active`);
					activePonds.push({
						name: pond.name,
						typeHash: pond.typeHash,
						minTossPrice: pondStatus[8], // minTossPrice from getPondStatus
					});
				} else {
					console.log(`❌ ${pond.name} pond is not active`);
				}
			} catch (error) {
				console.log(
					`❌ ${pond.name} pond does not exist or error: ${error.message}`,
				);
			}
		}

		if (activePonds.length === 0) {
			throw new Error(
				"❌ No active ponds found! Please create some ponds first.",
			);
		}

		console.log(
			`🎮 Found ${activePonds.length} active ponds to use for simulation`,
		);

		// Simulate tosses
		const simulationResults = {
			timestamp: new Date().toISOString(),
			network: networkName,
			accounts: [],
			totalTosses: 0,
			totalValueTossed: ethers.parseEther("0"),
		};

		// Random utilities
		function getRandomInt(min, max) {
			return Math.floor(Math.random() * (max - min + 1)) + min;
		}

		function getRandomPonds(ponds, count) {
			const shuffled = [...ponds].sort(() => 0.5 - Math.random());
			return shuffled.slice(0, count);
		}

		function getRandomEtherAmount(min, max) {
			// Generate a random BigInt between min and max
			const range = max - min;
			const randomOffset = BigInt(Math.floor(Math.random() * Number(range)));
			return min + randomOffset;
		}

		// Process each account
		for (let i = 0; i < accounts.length; i++) {
			const account = accounts[i];
			console.log(
				`\n👤 Processing account ${i + 1}/${accounts.length}: ${
					account.address
				}`,
			);

			try {
				// Create signer from private key
				const wallet = new ethers.Wallet(account.privateKey, ethers.provider);

				// Check account balance
				const balance = await ethers.provider.getBalance(account.address);
				console.log(`💰 Balance: ${ethers.formatEther(balance)} ETH`);

				if (balance < minTossAmount) {
					console.log(
						`⚠️ Insufficient balance for account ${account.address}, skipping...`,
					);
					continue;
				}

				// Decide how many ponds to use for this account
				const numPonds = getRandomInt(
					minPonds,
					Math.min(maxPonds, activePonds.length),
				);
				const selectedPonds = getRandomPonds(activePonds, numPonds);

				console.log(`🎯 Selected ${numPonds} ponds for this account`);

				const accountResult = {
					address: account.address,
					tosses: [],
				};

				// Toss coins into each selected pond
				for (const pond of selectedPonds) {
					// Decide how many tosses to make for this pond
					const numTosses = getRandomInt(minTosses, maxTosses);
					console.log(`🌊 Making ${numTosses} tosses into ${pond.name} pond`);

					const pondTosses = [];

					for (let j = 0; j < numTosses; j++) {
						// Generate random toss amount between min and max
						const tossAmount = getRandomEtherAmount(
							minTossAmount,
							maxTossAmount,
						);

						// Make sure toss amount is at least the pond's minimum
						const pondMinToss = pond.minTossPrice;
						const finalTossAmount =
							tossAmount > pondMinToss ? tossAmount : pondMinToss;

						console.log(
							`  📤 Toss ${j + 1}/${numTosses}: ${ethers.formatEther(
								finalTossAmount,
							)} ETH`,
						);

						try {
							// Execute the toss transaction
							const tx = await pondCore.connect(wallet).toss(
								pond.typeHash,
								0, // amount parameter (ignored for native ETH)
								{
									value: finalTossAmount,
									gasLimit: 300000, // Set a reasonable gas limit
								},
							);

							console.log(`  📝 Transaction sent: ${tx.hash}`);

							// Wait for transaction to be mined
							const receipt = await tx.wait();

							console.log(`  ✅ Toss successful! Gas used: ${receipt.gasUsed}`);

							// Record toss details
							pondTosses.push({
								amount: finalTossAmount.toString(),
								txHash: tx.hash,
							});

							simulationResults.totalTosses++;
							simulationResults.totalValueTossed += finalTossAmount;

							// Add a small random delay between tosses
							const delay = getRandomInt(1000, 3000);
							await new Promise((resolve) => setTimeout(resolve, delay));
						} catch (error) {
							console.error(`  ❌ Toss failed: ${error.message}`);

							// If we got a specific error that indicates we should stop
							if (error.message.includes("insufficient funds")) {
								console.log(
									"  ⚠️ Insufficient funds, stopping tosses for this account",
								);
								break;
							}
						}
					}

					// Add pond results to account
					if (pondTosses.length > 0) {
						accountResult.tosses.push({
							pond: pond.name,
							pondType: pond.typeHash,
							tosses: pondTosses,
						});
					}
				}

				// Add account results to simulation
				simulationResults.accounts.push(accountResult);
			} catch (error) {
				console.error(
					`❌ Error processing account ${account.address}: ${error.message}`,
				);
			}
		}

		// Save simulation results
		const resultsDir = path.join(__dirname, "../simulation-results");
		if (!fs.existsSync(resultsDir)) {
			fs.mkdirSync(resultsDir, { recursive: true });
		}

		const timestamp = Math.floor(Date.now() / 1000);
		const resultsPath = path.join(
			resultsDir,
			`toss_simulation_${timestamp}.json`,
		);

		// Format the total value tossed for JSON
		simulationResults.totalValueTossed =
			simulationResults.totalValueTossed.toString();

		fs.writeFileSync(resultsPath, JSON.stringify(simulationResults, null, 2));

		console.log("\n🎮 Simulation complete!");
		console.log(`📊 Total tosses: ${simulationResults.totalTosses}`);
		console.log(
			`💰 Total value tossed: ${ethers.formatEther(
				simulationResults.totalValueTossed,
			)} ETH`,
		);
		console.log(`💾 Results saved to: ${resultsPath}`);
	});

module.exports = {};
