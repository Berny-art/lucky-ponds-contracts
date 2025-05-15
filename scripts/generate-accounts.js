// scripts/generate-accounts.js
const { ethers } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
	console.log("Generating test accounts for LuckyPonds simulation...");

	// Number of accounts to generate
	const numAccounts = 20; // You can adjust this number
	const initialBalance = ethers.parseEther("10"); // 10 ETH per account

	// Array to store account data
	const accounts = [];

	// Generate accounts
	for (let i = 0; i < numAccounts; i++) {
		const wallet = ethers.Wallet.createRandom();
		accounts.push({
			address: wallet.address,
			privateKey: wallet.privateKey,
		});
		console.log(`Generated account ${i + 1}: ${wallet.address}`);
	}

	// Save accounts to a JSON file
	const outputDir = path.join(__dirname, "../");
	const outputFile = path.join(outputDir, "test-accounts.json");

	fs.writeFileSync(outputFile, JSON.stringify(accounts, null, 2));

	console.log(`\nGenerated ${numAccounts} test accounts`);
	console.log(`Accounts saved to: ${outputFile}`);
	console.log(
		"\nIMPORTANT: For testing purposes only. Never use these accounts in production!",
	);

	// Get the hardhat node URL
	const hre = require("hardhat");
	const network = hre.network;

	if (network.name === "hardhat" || network.name === "localhost") {
		console.log("\nTo use these accounts with a local network:");
		console.log(
			"1. Start a local node with: npx hardhat node --fork <YOUR_RPC_URL>",
		);
		console.log("2. Add account private keys to your hardhat.config.js");
		console.log("3. Or import them into MetaMask for testing\n");

		// If running on hardhat network, display instructions for funding accounts
		if (network.name === "hardhat") {
			console.log(
				"To fund these accounts, you can add them to your hardhat config or run:",
			);
			console.log("npx hardhat --network localhost faucet <ADDRESS>");

			// Create a simple faucet task in the output
			console.log(
				"\nYou can add this task to your hardhat.config.js to fund accounts:",
			);
			console.log(`
task("faucet", "Sends ETH to an address")
  .addPositionalParam("receiver", "The address that will receive ETH")
  .addOptionalParam("amount", "The amount of ETH to send", "1")
  .setAction(async ({ receiver, amount }, { ethers }) => {
    const [sender] = await ethers.getSigners();
    const tx = await sender.sendTransaction({
      to: receiver,
      value: ethers.parseEther(amount),
    });
    console.log(\`Sent \${amount} ETH to \${receiver} in transaction \${tx.hash}\`);
  });
`);
		}
	}
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	});
