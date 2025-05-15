// scripts/fund-accounts.js
const { ethers } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
	console.log("Funding test accounts for LuckyPonds simulation...");

	// Load accounts from JSON file
	const accountsFilePath = path.join(__dirname, "../test-accounts.json");

	if (!fs.existsSync(accountsFilePath)) {
		console.error("Error: test-accounts.json file not found.");
		console.log(
			"Please run 'npx hardhat run scripts/generate-accounts.js' first.",
		);
		return;
	}

	const accounts = JSON.parse(fs.readFileSync(accountsFilePath, "utf8"));
	console.log(`Loaded ${accounts.length} accounts from test-accounts.json`);

	// Get the funding account (first account in the hardhat node)
	const [funder] = await ethers.getSigners();
	const funderBalance = await ethers.provider.getBalance(funder.address);

	console.log(`Funder address: ${funder.address}`);
	console.log(`Funder balance: ${ethers.formatEther(funderBalance)} ETH`);

	if (funderBalance < ethers.parseEther("0.2") * BigInt(accounts.length)) {
		console.error("Error: Funder account doesn't have enough ETH.");
		console.log(
			`Required minimum: ${ethers.formatEther(
				ethers.parseEther("0.2") * BigInt(accounts.length),
			)} ETH`,
		);
		return;
	}

	// Amount to fund each account
	const fundAmount = ethers.parseEther("0.5"); // 0.5 ETH per account

	// Fund each account
	console.log(
		`\nFunding each account with ${ethers.formatEther(fundAmount)} ETH...`,
	);

	for (let i = 0; i < accounts.length; i++) {
		const address = accounts[i].address;

		// Create a wallet instance for the account
		const wallet = new ethers.Wallet(accounts[i].privateKey, ethers.provider);

		// Check current balance
		const initialBalance = await ethers.provider.getBalance(address);
		console.log(`Account ${i + 1}: ${address}`);
		console.log(`  Initial balance: ${ethers.formatEther(initialBalance)} ETH`);

		// Send ETH from funder to this account
		const tx = await funder.sendTransaction({
			to: address,
			value: fundAmount,
		});

		await tx.wait();

		// Verify new balance
		const newBalance = await ethers.provider.getBalance(address);
		console.log(`  New balance: ${ethers.formatEther(newBalance)} ETH`);
		console.log(`  ✅ Funded successfully (TX: ${tx.hash})`);
	}

	console.log("\nAll accounts funded successfully!");

	// Instructions for using these accounts
	console.log("\nNext Steps:");
	console.log("1. Run the simulation script:");
	console.log("   npx hardhat run scripts/simulate-lucky-ponds.js");
	console.log("   or");
	console.log("   npx hardhat run scripts/simulate-all-ponds.js");
	console.log(
		"\n2. For comprehensive testing, modify the simulation scripts to import",
	);
	console.log("   the accounts from test-accounts.json and use them directly.");
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
