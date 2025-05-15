// scripts/manage-community-distributions.js
const { ethers } = require("hardhat");
const fs = require("node:fs");
const Table = require("console-table-printer").Table;

// Load deployment data
const loadDeploymentInfo = () => {
	// Get the latest deployment file
	const deploymentDir = "./deployments";
	const files = fs.readdirSync(deploymentDir);
	const latestFile = files
		.filter((file) => file.startsWith("hyperliquid_"))
		.sort()
		.pop();

	if (!latestFile) {
		throw new Error("No deployment file found");
	}

	const deploymentPath = `${deploymentDir}/${latestFile}`;
	console.log(`Loading deployment info from: ${deploymentPath}`);
	return JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
};

// Format timestamp to readable date
const formatDate = (timestamp) => {
	return new Date(Number(timestamp) * 1000).toLocaleString();
};

// Format time remaining
const formatTimeRemaining = (seconds) => {
	if (seconds <= 0) return "Ready";

	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	let result = "";
	if (days > 0) result += `${days}d `;
	if (hours > 0) result += `${hours}h `;
	result += `${minutes}m`;

	return result;
};

// Handle command-line arguments
const parseArgs = () => {
	const args = process.argv.slice(2);
	const command = args[0] || "info";
	const options = {};

	for (let i = 1; i < args.length; i++) {
		if (args[i].startsWith("--")) {
			const option = args[i].slice(2);
			const value =
				args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true;
			options[option] = value;
			if (value !== true) i++;
		}
	}

	return { command, options };
};

async function main() {
	console.log("╔════════════════════════════════════════╗");
	console.log("║   COMMUNITY DISTRIBUTOR MANAGER TOOL   ║");
	console.log("╚════════════════════════════════════════╝");

	// Get the command and options
	const { command, options } = parseArgs();

	// Get network details
	const networkName = network.name;
	console.log(`Network: ${networkName}`);

	// Load deployment info
	const deploymentInfo = loadDeploymentInfo();
	const distributorAddress = deploymentInfo.luckyPondsDistributor;
	console.log(`LuckyPondsDistributor Contract: ${distributorAddress}`);

	// Get contract instance
	const LuckyPondsDistributor = await ethers.getContractFactory(
		"LuckyPondsDistributor",
	);
	const distributor = LuckyPondsDistributor.attach(distributorAddress);

	// Get hyperFrogsV2 address
	const hyperFrogsV2Address = deploymentInfo.hyperFrogsV2;
	const projectWallet = deploymentInfo.unmigratedClaimAddress;
	console.log(`HyperFrogsV2 Contract: ${hyperFrogsV2Address}`);
	console.log(`Project Wallet: ${projectWallet}`);

	// Get signer
	const [signer] = await ethers.getSigners();
	console.log(`Using signer: ${signer.address}`);

	// Process command
	switch (command) {
		case "info":
			await showDistributorInfo(distributor);
			break;
		case "create":
			await createDistribution(distributor, signer);
			break;
		case "claim": {
			const distributionId = options.id ? Number(options.id) : null;
			if (!distributionId && distributionId !== 0) {
				console.error("Error: --id parameter required");
				return;
			}
			await claimRewards(distributor, distributionId, signer);
			break;
		}
		case "claim-current":
			await claimCurrentRewards(distributor, signer);
			break;
		case "check-claimable": {
			const distId = options.id ? Number(options.id) : null;
			if (!distId && distId !== 0) {
				console.error("Error: --id parameter required");
				return;
			}
			const address = options.address || signer.address;
			await checkClaimable(distributor, distId, address);
			break;
		}
		case "check-creation":
			await checkCreationEligibility(
				distributor,
				options.address || signer.address,
			);
			break;
		case "reclaim": {
			const reclaimDistId = options.id ? Number(options.id) : null;
			if (!reclaimDistId && reclaimDistId !== 0) {
				console.error("Error: --id parameter required");
				return;
			}
			await reclaimUnclaimed(distributor, reclaimDistId, signer);
			break;
		}
		case "register-token":
			if (!options.token) {
				console.error("Error: --token parameter required");
				return;
			}
			await registerToken(distributor, options.token, signer);
			break;
		case "unregister-token":
			if (!options.token) {
				console.error("Error: --token parameter required");
				return;
			}
			await unregisterToken(distributor, options.token, signer);
			break;
		case "distributions":
			await listDistributions(distributor);
			break;
		default:
			console.log(`Unknown command: ${command}`);
			console.log(
				"Available commands: info, create, claim, claim-current, check-claimable, check-creation, reclaim, register-token, unregister-token, distributions",
			);
	}
}

async function showDistributorInfo(distributor) {
	console.log("\n📊 Distributor Information");
	console.log("══════════════════════════════════════════");

	try {
		// Get balances
		const balances = await distributor.getContractBalances();
		const nativeBalance = balances[0];
		const gasReserve = balances[1];
		const tokenAddresses = balances[2];
		const tokenBalances = balances[3];

		console.log(`Native Balance: ${ethers.formatEther(nativeBalance)} ETH`);
		console.log(`Gas Reserve: ${ethers.formatEther(gasReserve)} ETH`);
		console.log(
			`Distributable: ${ethers.formatEther(
				nativeBalance > gasReserve ? nativeBalance - gasReserve : 0,
			)} ETH`,
		);

		// Get migration stats
		const migrationStats = await distributor.getMigrationStats();
		const totalSupply = migrationStats[0];
		const migratedFrogs = migrationStats[1];
		const unmigratedFrogs = migrationStats[2];

		console.log(`\nCollection Size: ${totalSupply}`);
		console.log(`Migrated Frogs: ${migratedFrogs}`);
		console.log(`Unmigrated Frogs: ${unmigratedFrogs}`);

		// Show current distribution status
		const distributionActive = await distributor.distributionActive();
		const currentDistributionId = await distributor.currentDistributionId();

		console.log(`\nDistribution Active: ${distributionActive}`);
		if (distributionActive) {
			console.log(`Current Distribution ID: ${currentDistributionId}`);

			// Get distribution details
			const distInfo = await distributor.getDistributionInfo(
				currentDistributionId,
			);
			console.log(`Created: ${formatDate(distInfo[1])}`);
			console.log(`Claim Period Ends: ${formatDate(distInfo[2])}`);
			console.log(`Claimed Count: ${distInfo[4]} / ${totalSupply}`);
			console.log(`Native Amount: ${ethers.formatEther(distInfo[5])} ETH`);
			console.log(`Creator: ${distInfo[6]}`);

			// Calculate time remaining
			const currentTime = Math.floor(Date.now() / 1000);
			const timeRemaining = Number(distInfo[2]) - currentTime;
			if (timeRemaining > 0) {
				console.log(
					`Claim Period: ${formatTimeRemaining(timeRemaining)} remaining`,
				);
			} else {
				console.log("Claim Period: Ended");
			}
		} else {
			// Check if we can create a new distribution
			const timeCheck = await distributor.timeUntilNextDistribution();
			if (timeCheck[0]) {
				console.log("✅ New distribution can be created now");
			} else {
				console.log(
					`⏳ Next distribution can be created in: ${formatTimeRemaining(
						timeCheck[1],
					)}`,
				);
			}
		}

		// Check minimum frogs requirement
		const minFrogs = await distributor.minFrogsToCreateDistribution();
		console.log(`\nMinimum Frogs to Create Distribution: ${minFrogs}`);

		// Show tokens
		console.log("\nRegistered Tokens:");
		const supportedTokens = await distributor.getAllSupportedTokens();

		if (supportedTokens.length === 0) {
			console.log("No tokens registered");
		} else {
			const tokenTable = new Table({
				columns: [
					{ name: "address", title: "Token Address", alignment: "left" },
					{ name: "balance", title: "Balance", alignment: "right" },
				],
			});

			for (let i = 0; i < tokenAddresses.length; i++) {
				tokenTable.addRow({
					address: tokenAddresses[i],
					balance: tokenBalances[i].toString(),
				});
			}

			tokenTable.printTable();
		}
	} catch (error) {
		console.error(`Error getting distributor info: ${error.message}`);
	}
}

async function createDistribution(distributor, signer) {
	console.log("\n🔄 Creating New Distribution");
	console.log("══════════════════════════════════════════");

	try {
		// Check eligibility
		const canCreate = await distributor.canCreateDistribution();
		if (!canCreate[1]) {
			console.error(
				`Error: You only have ${
					canCreate[0]
				} frogs. Minimum required: ${await distributor.minFrogsToCreateDistribution()}`,
			);
			return;
		}

		// Check timing
		const timeCheck = await distributor.timeUntilNextDistribution();
		if (!timeCheck[0]) {
			console.error(
				`Error: Too early to create a new distribution. Wait ${formatTimeRemaining(
					timeCheck[1],
				)}`,
			);
			return;
		}

		// Create distribution
		console.log("Creating distribution...");
		const tx = await distributor.connect(signer).createDistribution();
		console.log(`Transaction sent: ${tx.hash}`);

		const receipt = await tx.wait();
		console.log(`Transaction confirmed: ${receipt.hash}`);

		// Get current distribution ID
		const currentDistributionId = await distributor.currentDistributionId();
		console.log(`\n✅ Distribution created with ID: ${currentDistributionId}`);

		// Get distribution details
		const distInfo = await distributor.getDistributionInfo(
			currentDistributionId,
		);
		console.log(`Created: ${formatDate(distInfo[1])}`);
		console.log(`Claim Period Ends: ${formatDate(distInfo[2])}`);
		console.log(`Native Amount: ${ethers.formatEther(distInfo[5])} ETH`);

		// Get tokens in this distribution
		const tokenAddresses = await distributor.getDistributionTokens(
			currentDistributionId,
		);
		if (tokenAddresses.length > 0) {
			console.log("\nTokens in distribution:");
			const tokenTable = new Table({
				columns: [
					{ name: "address", title: "Token Address", alignment: "left" },
					{ name: "amount", title: "Amount", alignment: "right" },
				],
			});

			for (const tokenAddr of tokenAddresses) {
				const amount = await distributor.getDistributionTokenAmount(
					currentDistributionId,
					tokenAddr,
				);
				tokenTable.addRow({
					address: tokenAddr,
					amount: amount.toString(),
				});
			}

			tokenTable.printTable();
		} else {
			console.log("No ERC-20 tokens in this distribution");
		}
	} catch (error) {
		console.error(`Error creating distribution: ${error.message}`);
	}
}

async function claimRewards(distributor, distributionId, signer) {
	console.log("\n🎁 Claiming Rewards");
	console.log("══════════════════════════════════════════");
	console.log(`Distribution ID: ${distributionId}`);
	console.log(`Claimer: ${signer.address}`);

	try {
		// Check if distribution exists
		const distributionCounter = await distributor.distributionCounter();
		if (distributionId > distributionCounter) {
			console.error(`Error: Distribution ID ${distributionId} does not exist`);
			return;
		}

		// Check if already claimed
		const hasClaimed = await distributor.hasClaimedDistribution(
			distributionId,
			signer.address,
		);
		if (hasClaimed) {
			console.error(
				`Error: Already claimed for distribution ID ${distributionId}`,
			);
			return;
		}

		// Check if unclaimed rewards were reclaimed
		const hasReclaimedUnclaimed =
			await distributor.hasReclaimedUnclaimed(distributionId);
		if (hasReclaimedUnclaimed) {
			console.error(
				`Error: Unclaimed rewards for distribution ID ${distributionId} have been reclaimed`,
			);
			return;
		}

		// Check claimable amount
		const claimable = await distributor.calculateClaimable(
			signer.address,
			distributionId,
		);
		const nativeAmount = claimable[0];
		const tokenAddresses = claimable[1];
		const tokenAmounts = claimable[2];
		const frogsOwned = claimable[3];

		if (frogsOwned.isZero()) {
			console.error("Error: No frogs owned by this address");
			return;
		}

		console.log(`Frogs Owned: ${frogsOwned}`);
		console.log(`Claimable ETH: ${ethers.formatEther(nativeAmount)} ETH`);

		if (tokenAddresses.length > 0) {
			console.log("Claimable Tokens:");
			for (let i = 0; i < tokenAddresses.length; i++) {
				console.log(`- ${tokenAddresses[i]}: ${tokenAmounts[i]}`);
			}
		}

		// Claim rewards
		console.log("\nClaiming rewards...");
		const tx = await distributor.connect(signer).claimRewards(distributionId);
		console.log(`Transaction sent: ${tx.hash}`);

		const receipt = await tx.wait();
		console.log("\n✅ Rewards claimed successfully!");
	} catch (error) {
		console.error(`Error claiming rewards: ${error.message}`);
	}
}

async function claimCurrentRewards(distributor, signer) {
	console.log("\n🎁 Claiming Current Distribution Rewards");
	console.log("══════════════════════════════════════════");

	try {
		// Check if there's an active distribution
		const distributionActive = await distributor.distributionActive();
		if (!distributionActive) {
			console.error("Error: No active distribution");
			return;
		}

		const currentDistributionId = await distributor.currentDistributionId();
		console.log(`Current Distribution ID: ${currentDistributionId}`);

		// Check if already claimed
		const hasClaimed = await distributor.hasClaimedDistribution(
			currentDistributionId,
			signer.address,
		);
		if (hasClaimed) {
			console.error("Error: Already claimed for the current distribution");
			return;
		}

		// Claim rewards
		console.log("Claiming rewards...");
		const tx = await distributor.connect(signer).claimCurrentRewards();
		console.log(`Transaction sent: ${tx.hash}`);

		const receipt = await tx.wait();
		console.log("\n✅ Rewards claimed successfully!");
	} catch (error) {
		console.error(`Error claiming current rewards: ${error.message}`);
	}
}

async function checkClaimable(distributor, distributionId, address) {
	console.log("\n👀 Checking Claimable Rewards");
	console.log("══════════════════════════════════════════");
	console.log(`Distribution ID: ${distributionId}`);
	console.log(`Address: ${address}`);

	try {
		// Check if distribution exists
		const distributionCounter = await distributor.distributionCounter();
		if (distributionId > distributionCounter) {
			console.error(`Error: Distribution ID ${distributionId} does not exist`);
			return;
		}

		// Check if already claimed
		const hasClaimed = await distributor.hasClaimedDistribution(
			distributionId,
			address,
		);
		if (hasClaimed) {
			console.log(
				`This address has already claimed rewards for distribution ID ${distributionId}`,
			);
			return;
		}

		// Check if unclaimed rewards were reclaimed
		const hasReclaimedUnclaimed =
			await distributor.hasReclaimedUnclaimed(distributionId);
		if (hasReclaimedUnclaimed) {
			console.log(
				`Unclaimed rewards for distribution ID ${distributionId} have been reclaimed`,
			);
			return;
		}

		// Get distribution info
		const distInfo = await distributor.getDistributionInfo(distributionId);
		console.log(`Distribution created: ${formatDate(distInfo[1])}`);
		console.log(`Claim period ends: ${formatDate(distInfo[2])}`);
		console.log(`Distribution active: ${distInfo[3]}`);
		console.log(`Claims so far: ${distInfo[4]}`);
		console.log(`Total ETH: ${ethers.formatEther(distInfo[5])} ETH`);

		// Check claimable amount
		const claimable = await distributor.calculateClaimable(
			address,
			distributionId,
		);
		const nativeAmount = claimable[0];
		const tokenAddresses = claimable[1];
		const tokenAmounts = claimable[2];
		const frogsOwned = claimable[3];

		console.log(`\nFrogs Owned: ${frogsOwned}`);

		if (frogsOwned.isZero()) {
			console.log("No frogs owned by this address");
			return;
		}

		console.log(`Claimable ETH: ${ethers.formatEther(nativeAmount)} ETH`);

		if (tokenAddresses.length > 0) {
			console.log("\nClaimable Tokens:");
			const tokenTable = new Table({
				columns: [
					{ name: "address", title: "Token Address", alignment: "left" },
					{ name: "amount", title: "Amount", alignment: "right" },
				],
			});

			for (let i = 0; i < tokenAddresses.length; i++) {
				tokenTable.addRow({
					address: tokenAddresses[i],
					amount: tokenAmounts[i].toString(),
				});
			}

			tokenTable.printTable();
		} else {
			console.log("No ERC-20 tokens claimable");
		}
	} catch (error) {
		console.error(`Error checking claimable rewards: ${error.message}`);
	}
}

async function checkCreationEligibility(distributor, address) {
	console.log("\n📋 Checking Eligibility to Create Distribution");
	console.log("══════════════════════════════════════════");
	console.log(`Address: ${address}`);

	try {
		// Check frogs owned
		const canCreate = await distributor.canCreateDistribution({
			from: address,
		});
		const frogsOwned = canCreate[0];
		const isEligible = canCreate[1];

		const minFrogs = await distributor.minFrogsToCreateDistribution();
		console.log(`Frogs Owned: ${frogsOwned}`);
		console.log(`Minimum Required: ${minFrogs}`);
		console.log(`Frogs Requirement: ${isEligible ? "✅ Met" : "❌ Not Met"}`);

		// Check timing
		const timeCheck = await distributor.timeUntilNextDistribution();
		const canCreateNow = timeCheck[0];
		const timeRemaining = timeCheck[1];

		console.log(
			`Timing Requirement: ${canCreateNow ? "✅ Met" : "❌ Not Met"}`,
		);
		if (!canCreateNow) {
			console.log(`Time until eligible: ${formatTimeRemaining(timeRemaining)}`);
		}

		// Overall eligibility
		console.log(
			`\nOverall Eligibility: ${
				isEligible && canCreateNow
					? "✅ Can create distribution"
					: "❌ Cannot create distribution"
			}`,
		);
	} catch (error) {
		console.error(`Error checking creation eligibility: ${error.message}`);
	}
}

async function reclaimUnclaimed(distributor, distributionId, signer) {
	console.log("\n🔄 Reclaiming Unclaimed Rewards");
	console.log("══════════════════════════════════════════");
	console.log(`Distribution ID: ${distributionId}`);

	try {
		// Check if distribution exists
		const distributionCounter = await distributor.distributionCounter();
		if (distributionId > distributionCounter) {
			console.error(`Error: Distribution ID ${distributionId} does not exist`);
			return;
		}

		// Check if already reclaimed
		const hasReclaimedUnclaimed =
			await distributor.hasReclaimedUnclaimed(distributionId);
		if (hasReclaimedUnclaimed) {
			console.error(
				`Error: Unclaimed rewards for distribution ID ${distributionId} have already been reclaimed`,
			);
			return;
		}

		// Get distribution info
		const distInfo = await distributor.getDistributionInfo(distributionId);
		const claimPeriodEnd = distInfo[2];
		const currentTime = Math.floor(Date.now() / 1000);

		if (currentTime < claimPeriodEnd) {
			console.error(
				`Error: Claim period has not ended yet. Ends at ${formatDate(
					claimPeriodEnd,
				)}`,
			);
			console.error(
				`Time remaining: ${formatTimeRemaining(claimPeriodEnd - currentTime)}`,
			);
			return;
		}

		// Reclaim unclaimed rewards
		console.log("Reclaiming unclaimed rewards...");
		const tx = await distributor
			.connect(signer)
			.reclaimUnclaimedRewards(distributionId);
		console.log(`Transaction sent: ${tx.hash}`);

		const receipt = await tx.wait();
		console.log("\n✅ Unclaimed rewards reclaimed successfully!");
	} catch (error) {
		console.error(`Error reclaiming unclaimed rewards: ${error.message}`);
	}
}

async function registerToken(distributor, tokenAddress, signer) {
	console.log("\n📝 Registering Token");
	console.log("══════════════════════════════════════════");
	console.log(`Token Address: ${tokenAddress}`);

	try {
		// Check if token is already registered
		const isSupported = await distributor.isTokenSupported(tokenAddress);
		if (isSupported) {
			console.log("Token is already registered");
			return;
		}

		// Register token
		const tx = await distributor.connect(signer).registerToken(tokenAddress);
		console.log(`Transaction sent: ${tx.hash}`);

		const receipt = await tx.wait();
		console.log(`\n✅ Token registered: ${tokenAddress}`);
	} catch (error) {
		console.error(`Error registering token: ${error.message}`);
	}
}

async function unregisterToken(distributor, tokenAddress, signer) {
	console.log("\n🗑️ Unregistering Token");
	console.log("══════════════════════════════════════════");
	console.log(`Token Address: ${tokenAddress}`);

	try {
		// Check if token is registered
		const isSupported = await distributor.isTokenSupported(tokenAddress);
		if (!isSupported) {
			console.log("Token is not registered");
			return;
		}

		// Unregister token
		const tx = await distributor.connect(signer).unregisterToken(tokenAddress);
		console.log(`Transaction sent: ${tx.hash}`);

		const receipt = await tx.wait();
		console.log(`\n✅ Token unregistered: ${tokenAddress}`);
	} catch (error) {
		console.error(`Error unregistering token: ${error.message}`);
	}
}

async function listDistributions(distributor) {
	console.log("\n📋 Listing All Distributions");
	console.log("══════════════════════════════════════════");

	try {
		// Get distribution counter
		const distributionCounter = await distributor.distributionCounter();
		console.log(`Total distributions: ${distributionCounter}`);

		if (distributionCounter.isZero()) {
			console.log("No distributions created yet");
			return;
		}

		const distributionTable = new Table({
			columns: [
				{ name: "id", title: "ID", alignment: "right" },
				{ name: "date", title: "Created", alignment: "left" },
				{ name: "ends", title: "Claim Ends", alignment: "left" },
				{ name: "status", title: "Status", alignment: "left" },
				{ name: "claimed", title: "Claimed", alignment: "right" },
				{ name: "amount", title: "ETH Amount", alignment: "right" },
				{ name: "creator", title: "Creator", alignment: "left" },
			],
		});

		// Calculate collection size
		const migrationStats = await distributor.getMigrationStats();
		const totalSupply = migrationStats[0];
		const currentTime = Math.floor(Date.now() / 1000);

		// List all distributions
		for (let i = 1; i <= distributionCounter; i++) {
			const distInfo = await distributor.getDistributionInfo(i);
			const id = distInfo[0];
			const timestamp = distInfo[1];
			const endTimestamp = distInfo[2];
			const active = distInfo[3];
			const claimedCount = distInfo[4];
			const nativeAmount = distInfo[5];
			const creator = distInfo[6];

			// Get reclaim status
			const hasReclaimedUnclaimed = await distributor.hasReclaimedUnclaimed(i);

			// Determine status
			let status = active ? "Active" : "Ended";
			if (currentTime < endTimestamp) {
				status = "Claiming";
			} else if (hasReclaimedUnclaimed) {
				status = "Reclaimed";
			} else if (currentTime >= endTimestamp && !active) {
				status = "Ready for Reclaim";
			}

			// Format creator address
			const shortCreator = `${creator.substring(0, 6)}...${creator.substring(
				38,
			)}`;

			distributionTable.addRow({
				id: id.toString(),
				date: formatDate(timestamp),
				ends: formatDate(endTimestamp),
				status: status,
				claimed: `${claimedCount} / ${totalSupply}`,
				amount: ethers.formatEther(nativeAmount),
				creator: shortCreator,
			});
		}

		distributionTable.printTable();
	} catch (error) {
		console.error(`Error listing distributions: ${error.message}`);
	}
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error("\n❌ Operation failed!");
		console.error(error);
		process.exit(1);
	});

// Usage examples:
// Show distributor info:
//   npx hardhat run scripts/manage-community-distributions.js --network hyperliquid_testnet
// Create a new distribution:
//   npx hardhat run scripts/manage-community-distributions.js --network hyperliquid_testnet create
// Claim rewards for a specific distribution:
//   npx hardhat run scripts/manage-community-distributions.js --network hyperliquid_testnet claim --id 1
// Claim rewards for the current active distribution:
//   npx hardhat run scripts/manage-community-distributions.js --network hyperliquid_testnet claim-current
// Check claimable rewards:
//   npx hardhat run scripts/manage-community-distributions.js --network hyperliquid_testnet check-claimable --id 1 --address 0x1234...
// Check if you can create a distribution:
//   npx hardhat run scripts/manage-community-distributions.js --network hyperliquid_testnet check-creation
// Reclaim unclaimed rewards after claim period ends:
//   npx hardhat run scripts/manage-community-distributions.js --network hyperliquid_testnet reclaim --id 1
// Register an ERC-20 token (admin only):
//   npx hardhat run scripts/manage-community-distributions.js --network hyperliquid_testnet register-token --token 0x1234...
// Unregister an ERC-20 token (admin only):
//   npx hardhat run scripts/manage-community-distributions.js --network hyperliquid_testnet unregister-token --token 0x1234...
// List all distributions:
//   npx hardhat run scripts/manage-community-distributions.js --network hyperliquid_testnet distributions
