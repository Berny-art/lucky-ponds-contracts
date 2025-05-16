// tasks/query-ponds.js
const { Table } = require("console-table-printer");

// Helper function to format timestamps
function formatDate(timestamp) {
	return new Date(timestamp * 1000).toLocaleString();
}

// Helper function to format ETH amounts
function formatEther(amount) {
	return `${ethers.formatEther(amount)} ETH`;
}

// Helper function to format time remaining
function formatTimeRemaining(seconds) {
	if (seconds <= 0) return "Ended";

	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	let result = "";
	if (days > 0) result += `${days}d `;
	if (hours > 0) result += `${hours}h `;
	result += `${minutes}m`;

	return result;
}

// Token type mapping for readability
const TOKEN_TYPES = {
	0: "Native ETH",
	1: "ERC20",
};

// Period type mapping for readability
const PERIOD_TYPES = {
	0: "Five-Min",
	1: "Hourly",
	2: "Daily",
	3: "Weekly",
	4: "Monthly",
	5: "Custom",
};

task("query-ponds", "Query all ponds in the system")
	.addOptionalParam("core", "PondCore address (will use env if not provided)")
	.addFlag("all", "Show all ponds, not just standard ones")
	.addFlag("active", "Show only active ponds")
	.addFlag("extended", "Show extended details for each pond")
	.setAction(async (taskArgs, hre) => {
		const { ethers } = hre;

		console.log("🔍 Querying ponds...");

		// Get network information
		const network = await ethers.provider.getNetwork();
		const networkName = network.name;
		const isTestnet =
			networkName.includes("testnet") || networkName === "hyperliquid_testnet";
		const configPrefix = isTestnet ? "TESTNET" : "MAINNET";

		console.log(
			`🌐 Network: ${networkName} (${isTestnet ? "🧪 Testnet" : "🔴 Mainnet"})`,
		);

		// Get PondCore address - from task args or environment
		const pondCoreAddress =
			taskArgs.core || process.env[`${configPrefix}_POND_CORE_ADDRESS`];

		if (!pondCoreAddress || !ethers.isAddress(pondCoreAddress)) {
			throw new Error(
				"❌ No valid PondCore address provided or found in environment variables",
			);
		}

		console.log(`🌟 Using PondCore: ${pondCoreAddress}`);

		// Connect to PondCore
		const pondCore = await ethers.getContractAt("PondCore", pondCoreAddress);

		// Get standard pond types
		const standardTypes = await pondCore.getStandardPondTypes();

		// Create an object with all standard pond identifiers
		const standardPonds = {
			"Five-Min": standardTypes[0],
			Hourly: standardTypes[1],
			Daily: standardTypes[2],
			Weekly: standardTypes[3],
			Monthly: standardTypes[4],
		};

		console.log("📊 Standard pond identifiers:");
		for (const [name, hash] of Object.entries(standardPonds)) {
			console.log(`- ${name}: ${hash}`);
		}

		// Check for ERC20 token ponds if displaying all ponds
		let tokenPonds = [];
		if (taskArgs.all) {
			try {
				console.log("\n🔍 Searching for custom or ERC20 token ponds...");

				// Get all pond types
				const allPondTypes = await pondCore.getAllPondTypes();
				console.log(`📊 Found ${allPondTypes.length} total ponds`);

				// Filter out standard ponds
				const standardPondValues = Object.values(standardPonds);
				tokenPonds = allPondTypes.filter(
					(pondType) => !standardPondValues.some((std) => std === pondType),
				);

				console.log(`📊 Found ${tokenPonds.length} custom/token ponds`);
			} catch (error) {
				console.error(`❌ Error getting all pond types: ${error.message}`);
			}
		}

		// Check each pond and collect data
		const standardPondData = [];

		console.log("\n🔍 Checking standard pond status...");
		for (const [name, pondType] of Object.entries(standardPonds)) {
			try {
				const status = await pondCore.getPondStatus(pondType);

				// Parse the pond data
				const pondData = {
					name: status[0] || name,
					type: name,
					typeHash: `${pondType.slice(0, 8)}...`, // Truncated hash
					startTime: Number(status[1]),
					endTime: Number(status[2]),
					totalTosses: Number(status[3]),
					totalValue: status[4],
					totalParticipants: Number(status[5]),
					prizeDistributed: status[6],
					timeUntilEnd: Number(status[7]),
					minTossPrice: status[8],
					maxTotalTossAmount: status[9],
					tokenType: Number(status[10]),
					tokenAddress: status[11],
					period: Number(status[12]),
				};

				// Format for display
				pondData.formattedStartTime = formatDate(pondData.startTime);
				pondData.formattedEndTime = formatDate(pondData.endTime);
				pondData.formattedValue = formatEther(pondData.totalValue);
				pondData.formattedMinPrice = formatEther(pondData.minTossPrice);
				pondData.formattedMaxAmount = formatEther(pondData.maxTotalTossAmount);
				pondData.formattedTimeLeft = formatTimeRemaining(pondData.timeUntilEnd);
				pondData.tokenTypeName = TOKEN_TYPES[pondData.tokenType];
				pondData.periodName = PERIOD_TYPES[pondData.period];
				pondData.status = pondData.timeUntilEnd > 0 ? "Active" : "Ended";

				// Only add if all ponds requested, or it's active and only active requested
				if (!taskArgs.active || pondData.timeUntilEnd > 0) {
					standardPondData.push(pondData);
				}
			} catch (error) {
				console.log(
					`❌ ${name} pond does not exist or error: ${error.message}`,
				);
			}
		}

		// Get custom/token pond data if requested
		const customPondData = [];
		if (taskArgs.all && tokenPonds.length > 0) {
			console.log("\n🔍 Checking custom/token pond status...");

			for (const pondType of tokenPonds) {
				try {
					const status = await pondCore.getPondStatus(pondType);

					// Parse the pond data
					const pondData = {
						name: status[0],
						type: "Custom",
						typeHash: `${pondType.slice(0, 8)}...`, // Truncated hash
						startTime: Number(status[1]),
						endTime: Number(status[2]),
						totalTosses: Number(status[3]),
						totalValue: status[4],
						totalParticipants: Number(status[5]),
						prizeDistributed: status[6],
						timeUntilEnd: Number(status[7]),
						minTossPrice: status[8],
						maxTotalTossAmount: status[9],
						tokenType: Number(status[10]),
						tokenAddress: status[11],
						period: Number(status[12]),
					};

					// Format for display
					pondData.formattedStartTime = formatDate(pondData.startTime);
					pondData.formattedEndTime = formatDate(pondData.endTime);
					pondData.formattedValue = formatEther(pondData.totalValue);
					pondData.formattedMinPrice = formatEther(pondData.minTossPrice);
					pondData.formattedMaxAmount = formatEther(
						pondData.maxTotalTossAmount,
					);
					pondData.formattedTimeLeft = formatTimeRemaining(
						pondData.timeUntilEnd,
					);
					pondData.tokenTypeName = TOKEN_TYPES[pondData.tokenType];
					pondData.periodName = PERIOD_TYPES[pondData.period];
					pondData.status = pondData.timeUntilEnd > 0 ? "Active" : "Ended";

					// Check if it's a token, try to get the symbol
					if (
						pondData.tokenType === 1 &&
						pondData.tokenAddress !== ethers.ZeroAddress
					) {
						try {
							const tokenContract = await ethers.getContractAt(
								"IERC20Metadata",
								pondData.tokenAddress,
							);
							const symbol = await tokenContract.symbol();
							pondData.name = `${symbol} ${pondData.periodName} Pond`;
							pondData.tokenSymbol = symbol;
						} catch (e) {
							pondData.tokenSymbol = "Unknown";
						}
					}

					// Only add if all ponds requested, or it's active and only active requested
					if (!taskArgs.active || pondData.timeUntilEnd > 0) {
						customPondData.push(pondData);
					}
				} catch (error) {
					console.log(
						`❌ Pond ${pondType.slice(0, 8)}... does not exist or error: ${
							error.message
						}`,
					);
				}
			}
		}

		// Combine all pond data
		const allPondData = [...standardPondData, ...customPondData];

		if (allPondData.length === 0) {
			console.log("\n❌ No ponds found matching criteria");
			return;
		}

		// Sort ponds by status (active first) then by name
		allPondData.sort((a, b) => {
			// First by status (active first)
			const statusCompare =
				a.status === "Active" ? -1 : b.status === "Active" ? 1 : 0;
			if (statusCompare !== 0) return statusCompare;

			// Then by name
			return a.name.localeCompare(b.name);
		});

		// Display results in a table
		console.log(
			`\n📊 Found ${allPondData.length} ponds (${
				taskArgs.active ? "active only" : "all"
			}):`,
		);

		// Create the table
		const table = new Table({
			title: taskArgs.active ? "Active Ponds" : "All Ponds",
			columns: [
				{ name: "name", title: "Pond Name", alignment: "left" },
				{ name: "status", title: "Status", alignment: "center" },
				{ name: "type", title: "Type", alignment: "center" },
				{ name: "totalTosses", title: "Tosses", alignment: "right" },
				{ name: "totalParticipants", title: "Users", alignment: "right" },
				{ name: "formattedValue", title: "Total Value", alignment: "right" },
				{ name: "formattedTimeLeft", title: "Time Left", alignment: "center" },
			],
		});

		// Add extended columns if requested
		if (taskArgs.extended) {
			table.columns.push(
				{
					name: "formattedStartTime",
					title: "Start Time",
					alignment: "center",
				},
				{ name: "formattedEndTime", title: "End Time", alignment: "center" },
				{ name: "tokenTypeName", title: "Token Type", alignment: "center" },
				{ name: "formattedMinPrice", title: "Min Price", alignment: "right" },
				{ name: "typeHash", title: "ID", alignment: "center" },
			);
		}

		// Add rows to the table
		for (const pond of allPondData) {
			const row = {
				name: pond.name,
				status: pond.status,
				type: pond.periodName,
				totalTosses: pond.totalTosses,
				totalParticipants: pond.totalParticipants,
				formattedValue: pond.formattedValue,
				formattedTimeLeft: pond.formattedTimeLeft,
			};

			// Add extended info if requested
			if (taskArgs.extended) {
				row.formattedStartTime = pond.formattedStartTime;
				row.formattedEndTime = pond.formattedEndTime;
				row.tokenTypeName = pond.tokenTypeName;
				row.formattedMinPrice = pond.formattedMinPrice;
				row.typeHash = pond.typeHash;
			}

			// Color coding based on status
			if (pond.status === "Active") {
				table.addRow(row, { color: "green" });
			} else {
				table.addRow(row, { color: "gray" });
			}
		}

		// Print the table
		table.printTable();

		// Additional details for specific ponds if extended info requested
		if (taskArgs.extended) {
			console.log("\n📝 Additional Details for Active Ponds:");

			for (const pond of allPondData.filter((p) => p.status === "Active")) {
				console.log(`\n🏊 ${pond.name} (${pond.typeHash}):`);
				console.log(`- Period: ${pond.periodName}`);
				console.log(
					`- Token: ${pond.tokenTypeName}${
						pond.tokenSymbol ? ` (${pond.tokenSymbol})` : ""
					}`,
				);

				if (pond.tokenType === 1) {
					console.log(`- Token Address: ${pond.tokenAddress}`);
				}

				console.log(
					`- Time Window: ${pond.formattedStartTime} to ${pond.formattedEndTime}`,
				);
				console.log(`- Time Remaining: ${pond.formattedTimeLeft}`);
				console.log(`- Min Toss Price: ${pond.formattedMinPrice}`);
				console.log(`- Max Total Amount: ${pond.formattedMaxAmount}`);
				console.log(
					`- Activity: ${pond.totalTosses} tosses from ${pond.totalParticipants} participants`,
				);
				console.log(`- Total Value: ${pond.formattedValue}`);
			}
		}
	});

module.exports = {};
