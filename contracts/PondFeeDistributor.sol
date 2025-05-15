// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

// Interface for NFT contract to get holder balance
interface INFTContract {
    function totalMigrated() external view returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
}

/**
 * @title PondFeeDistributor
 * @dev Simplified contract for distributing ETH and ERC-20 tokens to NFT holders
 * with single active distribution and automatic unclaimed rewards transfer
 */
contract PondFeeDistributor is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    
    // ======== Custom Errors ========
    error NoRewardsToClaim();
    error TransferFailed();
    error ZeroAddress();
    error InvalidAmount();
    error InvalidPeriod();
    error NoDistributionInProgress();
    error DistributionInProgress();
    error InsufficientBalance();
    error NotNFTHolder();
    error InvalidToken();
    error AlreadyClaimed();
    error NotAuthorized();
    error ClaimPeriodActive();
    error TokenTransferFailed();

    // ======== Roles ========
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ======== State Variables ========
    // The NFT collection contract
    INFTContract public immutable nftContract;
    
    // Address that receives unclaimed rewards
    address public immutable projectWallet;
    
    // Total collection size
    uint256 public constant COLLECTION_SIZE = 2222;
    
    // Claim period duration (default and min values)
    uint256 public claimPeriod;
    uint256 public constant MIN_CLAIM_PERIOD = 1 days;
    
    // Amount of ETH to keep reserved for gas (not distributed)
    uint256 public gasReserve;
    
    // Minimum number of NFTs required to create a distribution
    uint256 public minNFTsToCreateDistribution;
    
    // Distribution state
    struct Distribution {
        uint256 startTime;        // Creation timestamp
        uint256 endTime;          // When the claim period ends
        uint256 claimedCount;     // Number of NFTs that have claimed
        bool active;              // Whether the distribution is active
        address creator;          // Address that created the distribution
        uint256 nativeAmount;     // Amount of native currency in the distribution
        address[] tokenAddresses; // Token addresses in the distribution
        mapping(address => uint256) tokenAmounts; // Token amounts in the distribution
    }
    
    // Single active distribution
    Distribution public currentDistribution;
    
    // List of supported token addresses for distribution
    address[] public supportedTokens;
    
    // Mapping to check if a token is supported
    mapping(address => bool) public isTokenSupported;
    
    // Mapping of claimed status per address
    mapping(address => bool) public hasClaimed;
    
    // Flag for tracking if unclaimed rewards for unmigrated tokens are claimed
    bool public unmigratedClaimed;
    
    // ======== Events ========
    event DistributionCreated(uint256 nativeAmount, uint256 timestamp, address creator);
    event DistributionEnded(uint256 claimedCount, uint256 unclaimedAmount);
    event RewardsClaimed(address indexed claimer, uint256 nativeAmount, uint256 nfts);
    event TokenRewardClaimed(address indexed claimer, address tokenAddress, uint256 amount);
    event UnmigratedRewardsClaimed(address indexed receiver, uint256 nfts);
    event TokenRegistered(address tokenAddress);
    event TokenUnregistered(address tokenAddress);
    event EmergencyWithdrawal(address indexed recipient, uint256 amount, string reason);
    event EmergencyTokenWithdrawal(address indexed recipient, address indexed token, uint256 amount, string reason);
    event ClaimPeriodUpdated(uint256 oldPeriod, uint256 newPeriod);
    event DistributionForcedEnd(address admin, uint256 timestamp);

    /**
     * @dev Constructor
     * @param _nftContract The address of the NFT contract
     * @param _projectWallet Address that receives unclaimed rewards
     * @param _gasReserve Amount of ETH to keep reserved for gas (in wei)
     * @param _minNFTsToCreateDistribution Minimum NFTs required to create a distribution
     * @param _initialClaimPeriod Initial claim period duration (in seconds)
     */
    constructor(
        address _nftContract,
        address _projectWallet,
        uint256 _gasReserve,
        uint256 _minNFTsToCreateDistribution,
        uint256 _initialClaimPeriod
    ) {
        if (_nftContract == address(0) || _projectWallet == address(0)) {
            revert ZeroAddress();
        }
        
        nftContract = INFTContract(_nftContract);
        projectWallet = _projectWallet;
        gasReserve = _gasReserve;
        minNFTsToCreateDistribution = _minNFTsToCreateDistribution;
        
        // Set initial claim period (minimum 1 day, default 7 days if not specified)
        if (_initialClaimPeriod < MIN_CLAIM_PERIOD) {
            claimPeriod = 7 days;
        } else {
            claimPeriod = _initialClaimPeriod;
        }
        
        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    /**
     * @dev Modifier to check if distribution is active and not paused
     */
    modifier onlyActiveDistribution() {
        if (!currentDistribution.active) {
            revert NoDistributionInProgress();
        }
        _;
    }
    
    /**
     * @dev Update the gas reserve amount
     * @param _newReserve New amount to reserve
     */
    function updateGasReserve(uint256 _newReserve) external onlyRole(ADMIN_ROLE) {
        gasReserve = _newReserve;
    }
    
    /**
     * @dev Update minimum NFTs required to create a distribution
     * @param _newRequirement New minimum requirement
     */
    function updateMinNFTsRequirement(uint256 _newRequirement) external onlyRole(ADMIN_ROLE) {
        if (_newRequirement == 0) revert InvalidAmount();
        minNFTsToCreateDistribution = _newRequirement;
    }
    
    /**
     * @dev Update the claim period
     * @param _newClaimPeriod New claim period duration (in seconds)
     */
    function updateClaimPeriod(uint256 _newClaimPeriod) external onlyRole(ADMIN_ROLE) {
        if (_newClaimPeriod < MIN_CLAIM_PERIOD) revert InvalidPeriod();
        
        uint256 oldPeriod = claimPeriod;
        claimPeriod = _newClaimPeriod;
        
        emit ClaimPeriodUpdated(oldPeriod, _newClaimPeriod);
    }
    
    /**
     * @dev Register a token to be included in distributions
     * @param _tokenAddress The ERC-20 token address
     */
    function registerToken(address _tokenAddress) external onlyRole(ADMIN_ROLE) {
        if (_tokenAddress == address(0)) revert ZeroAddress();
        if (isTokenSupported[_tokenAddress]) return; // Already registered
        
        // Basic validation of token - check if it implements balanceOf
        // We have to use try/catch here because it's an external call
        try IERC20(_tokenAddress).balanceOf(address(this)) returns (uint256) {
            supportedTokens.push(_tokenAddress);
            isTokenSupported[_tokenAddress] = true;
            emit TokenRegistered(_tokenAddress);
        } catch {
            revert InvalidToken();
        }
    }
    
    /**
     * @dev Unregister a token from distributions
     * @param _tokenAddress The ERC-20 token address
     */
    function unregisterToken(address _tokenAddress) external onlyRole(ADMIN_ROLE) {
        if (!isTokenSupported[_tokenAddress]) return; // Not registered
        
        // Find and remove token from array
        for (uint i = 0; i < supportedTokens.length; i++) {
            if (supportedTokens[i] == _tokenAddress) {
                // Swap and pop
                supportedTokens[i] = supportedTokens[supportedTokens.length - 1];
                supportedTokens.pop();
                break;
            }
        }
        
        isTokenSupported[_tokenAddress] = false;
        emit TokenUnregistered(_tokenAddress);
    }

    /**
     * @dev Check if sender can create a distribution
     * @return nftsOwned Number of NFTs owned by sender
     * @return canCreate Whether sender has enough NFTs to create a distribution
     * @return timeRemaining Time remaining until current distribution can be ended (0 if no active distribution)
     */
    function canCreateDistribution() public view returns (uint256 nftsOwned, bool canCreate, uint256 timeRemaining) {
        nftsOwned = nftContract.balanceOf(msg.sender);
        
        if (currentDistribution.active) {
            if (block.timestamp < currentDistribution.endTime && !hasRole(ADMIN_ROLE, msg.sender)) {
                timeRemaining = currentDistribution.endTime - block.timestamp;
                canCreate = false;
            } else {
                // Distribution has ended or caller is admin
                timeRemaining = 0;
                canCreate = hasRole(ADMIN_ROLE, msg.sender) || nftsOwned >= minNFTsToCreateDistribution;
            }
        } else {
            timeRemaining = 0;
            canCreate = nftsOwned >= minNFTsToCreateDistribution || hasRole(ADMIN_ROLE, msg.sender);
        }
        
        return (nftsOwned, canCreate, timeRemaining);
    }

    /**
     * @dev Force end the current distribution (admin only)
     * This allows an admin to end a distribution early and start a new one
     */
    function forceEndDistribution() external onlyRole(ADMIN_ROLE) onlyActiveDistribution {
        // Send unclaimed rewards to project wallet just like normal end
        _endDistributionInternal();
        
        emit DistributionForcedEnd(msg.sender, block.timestamp);
    }

    /**
     * @dev Create a new distribution with all available tokens
     * Any NFT holder with minimum required NFTs can create a distribution
     */
    function createDistribution() external nonReentrant whenNotPaused {
        // Check if sender has permission
        (uint256 nftsOwned, bool canCreate, ) = canCreateDistribution();
        if (!canCreate) {
            if (nftsOwned < minNFTsToCreateDistribution && !hasRole(ADMIN_ROLE, msg.sender)) {
                revert NotNFTHolder();
            } else {
                revert DistributionInProgress();
            }
        }
        
        // If there's an existing distribution that has ended, end it properly first
        if (currentDistribution.active) {
            if (hasRole(ADMIN_ROLE, msg.sender) || block.timestamp >= currentDistribution.endTime) {
                _endDistributionInternal();
            } else {
                revert DistributionInProgress();
            }
        }
        
        // Check token support
        if (supportedTokens.length == 0) {
            // At least validate we have ETH to distribute
            uint256 tokenBalance = address(this).balance;
            if (tokenBalance <= gasReserve) {
                revert InsufficientBalance();
            }
        }
        
        // Calculate distributable native amount (total balance - gas reserve)
        uint256 contractBalance = address(this).balance;
        uint256 distributableNative = 0;
        
        if (contractBalance > gasReserve) {
            distributableNative = contractBalance - gasReserve;
        }
        
        // Create new distribution
        currentDistribution.startTime = block.timestamp;
        currentDistribution.endTime = block.timestamp + claimPeriod;
        currentDistribution.active = true;
        currentDistribution.claimedCount = 0;
        currentDistribution.creator = msg.sender;
        currentDistribution.nativeAmount = distributableNative;
        
        // Clean up previous claims tracking
        unmigratedClaimed = false;
        
        // Add all supported tokens to distribution
        // First cleanup existing token addresses array
        delete currentDistribution.tokenAddresses;
        
        // Then add all tokens with positive balance
        for (uint i = 0; i < supportedTokens.length; i++) {
            address tokenAddr = supportedTokens[i];
            
            // We have to use try/catch here because it's an external call
            try IERC20(tokenAddr).balanceOf(address(this)) returns (uint256 tokenBalance) {
                if (tokenBalance > 0) {
                    currentDistribution.tokenAddresses.push(tokenAddr);
                    currentDistribution.tokenAmounts[tokenAddr] = tokenBalance;
                }
            } catch {
                // Skip invalid tokens
                continue;
            }
        }
        
        emit DistributionCreated(distributableNative, block.timestamp, msg.sender);
    }
    
    /**
     * @dev End the current distribution
     * Only allowed after claim period and by anyone with minimum required NFTs
     * All unclaimed rewards are automatically sent to project wallet
     */
    function endDistribution() external nonReentrant whenNotPaused onlyActiveDistribution {
        // Check if claim period has ended
        if (block.timestamp < currentDistribution.endTime) {
            revert NotAuthorized();
        }
        
        // Verify sender has enough NFTs to end distribution
        uint256 nftsOwned = nftContract.balanceOf(msg.sender);
        if (nftsOwned < minNFTsToCreateDistribution && !hasRole(ADMIN_ROLE, msg.sender)) {
            revert NotNFTHolder();
        }
        
        _endDistributionInternal();
    }
    
    /**
     * @dev Internal function to end distribution and send unclaimed rewards
     */
    function _endDistributionInternal() internal {
        // Calculate unclaimed amounts
        uint256 totalClaimed = currentDistribution.claimedCount;
        uint256 unclaimed = COLLECTION_SIZE - totalClaimed;
        uint256 unclaimedNative = 0;
        
        if (unclaimed > 0) {
            // Calculate unclaimed percentages
            uint256 unclaimedPercentage = (unclaimed * 1e18) / COLLECTION_SIZE;
            
            // Calculate unclaimed native tokens
            unclaimedNative = (currentDistribution.nativeAmount * unclaimedPercentage) / 1e18;
            
            if (unclaimedNative > 0) {
                // Send to project wallet
                (bool success, ) = projectWallet.call{value: unclaimedNative}("");
                if (!success) revert TransferFailed();
            }
            
            // Send unclaimed ERC-20 tokens
            for (uint i = 0; i < currentDistribution.tokenAddresses.length; i++) {
                address tokenAddr = currentDistribution.tokenAddresses[i];
                uint256 tokenTotal = currentDistribution.tokenAmounts[tokenAddr];
                uint256 unclaimedToken = (tokenTotal * unclaimedPercentage) / 1e18;
                
                if (unclaimedToken > 0) {
                    // Use safeTransfer without try/catch since it handles errors internally
                    IERC20(tokenAddr).safeTransfer(projectWallet, unclaimedToken);
                }
            }
        }
        
        // Mark distribution as inactive
        currentDistribution.active = false;
        
        emit DistributionEnded(totalClaimed, unclaimedNative);
    }
    
    /**
     * @dev Calculate number of NFTs owned by an address
     * @param _holder The address to check
     * @return nftsOwned Number of NFTs owned
     * @return isUnmigrated Whether this is the unmigrated claim address
     */
    function calculateNFTsOwned(address _holder) public view returns (
        uint256 nftsOwned,
        bool isUnmigrated
    ) {
        // Special case for project wallet (unmigrated tokens claim address)
        if (_holder == projectWallet) {
            // Get the count of unmigrated NFTs
            uint256 totalMigrated = nftContract.totalMigrated();
            uint256 unmigrated = COLLECTION_SIZE - totalMigrated;
            
            return (unmigrated, true);
        }
        
        // Regular holder
        return (nftContract.balanceOf(_holder), false);
    }
    
    /**
     * @dev Calculate claimable amounts for holder
     * @param _holder The address to check
     * @return nativeAmount Amount of native tokens claimable
     * @return tokenAddresses Array of ERC-20 token addresses
     * @return tokenAmounts Array of ERC-20 token amounts
     * @return nftsOwned Number of NFTs owned
     */
    function calculateClaimable(address _holder) public view returns (
        uint256 nativeAmount,
        address[] memory tokenAddresses,
        uint256[] memory tokenAmounts,
        uint256 nftsOwned
    ) {
        // Check if distribution is active
        if (!currentDistribution.active) {
            return (0, new address[](0), new uint256[](0), 0);
        }
        
        // Check if already claimed
        bool claimed;
        if (_holder == projectWallet) {
            claimed = unmigratedClaimed;
        } else {
            claimed = hasClaimed[_holder];
        }
        
        if (claimed) {
            return (0, new address[](0), new uint256[](0), 0);
        }
        
        // Calculate NFTs owned
        bool isUnmigrated;
        (nftsOwned, isUnmigrated) = calculateNFTsOwned(_holder);
        
        if (nftsOwned == 0) {
            return (0, new address[](0), new uint256[](0), 0);
        }
        
        // Calculate native token amount
        nativeAmount = (currentDistribution.nativeAmount * nftsOwned) / COLLECTION_SIZE;
        
        // Calculate ERC-20 token amounts
        tokenAddresses = currentDistribution.tokenAddresses;
        tokenAmounts = new uint256[](tokenAddresses.length);
        
        for (uint i = 0; i < tokenAddresses.length; i++) {
            address tokenAddr = tokenAddresses[i];
            uint256 tokenAmt = currentDistribution.tokenAmounts[tokenAddr];
            tokenAmounts[i] = (tokenAmt * nftsOwned) / COLLECTION_SIZE;
        }
        
        return (nativeAmount, tokenAddresses, tokenAmounts, nftsOwned);
    }
    
    /**
     * @dev Claim rewards for the current distribution
     */
    function claimRewards() external nonReentrant whenNotPaused onlyActiveDistribution {
        // Calculate claimable before modifying state
        (
            uint256 nativeAmount,
            address[] memory tokenAddresses,
            uint256[] memory tokenAmounts,
            uint256 nftsOwned
        ) = calculateClaimable(msg.sender);
        
        if (nftsOwned == 0) revert NoRewardsToClaim();
        
        // Update state BEFORE transfers to prevent reentrancy issues
        // Mark as claimed
        if (msg.sender == projectWallet) {
            unmigratedClaimed = true;
            emit UnmigratedRewardsClaimed(msg.sender, nftsOwned);
        } else {
            hasClaimed[msg.sender] = true;
            emit RewardsClaimed(msg.sender, nativeAmount, nftsOwned);
        }
        
        // Update claim count
        currentDistribution.claimedCount += nftsOwned;
        
        // Send native tokens if available
        if (nativeAmount > 0) {
            (bool success, ) = msg.sender.call{value: nativeAmount}("");
            if (!success) revert TransferFailed();
        }
        
        // Send ERC-20 tokens
        for (uint i = 0; i < tokenAddresses.length; i++) {
            address tokenAddr = tokenAddresses[i];
            uint256 tokenAmt = tokenAmounts[i];
            
            if (tokenAmt > 0) {
                // Use safeTransfer without try/catch - it handles errors internally
                IERC20(tokenAddr).safeTransfer(msg.sender, tokenAmt);
                emit TokenRewardClaimed(msg.sender, tokenAddr, tokenAmt);
            }
        }
    }
    
    /**
     * @dev Get distribution info
     * @return startTime Creation timestamp
     * @return endTime End of claim period timestamp
     * @return active Whether distribution is active
     * @return claimedCount Number of NFTs that have claimed
     * @return nativeAmount Amount of native tokens in the distribution
     * @return creator Address that created the distribution
     */
    function getDistributionInfo() external view returns (
        uint256 startTime,
        uint256 endTime,
        bool active,
        uint256 claimedCount,
        uint256 nativeAmount,
        address creator
    ) {
        return (
            currentDistribution.startTime,
            currentDistribution.endTime,
            currentDistribution.active,
            currentDistribution.claimedCount,
            currentDistribution.nativeAmount,
            currentDistribution.creator
        );
    }
    
    /**
     * @dev Get current distribution token info
     * @return tokenAddresses Array of token addresses in the distribution
     * @return tokenAmounts Array of corresponding token amounts
     */
    function getDistributionTokenInfo() external view returns (
        address[] memory tokenAddresses,
        uint256[] memory tokenAmounts
    ) {
        if (!currentDistribution.active) {
            return (new address[](0), new uint256[](0));
        }
        
        tokenAddresses = currentDistribution.tokenAddresses;
        tokenAmounts = new uint256[](tokenAddresses.length);
        
        for (uint i = 0; i < tokenAddresses.length; i++) {
            tokenAmounts[i] = currentDistribution.tokenAmounts[tokenAddresses[i]];
        }
        
        return (tokenAddresses, tokenAmounts);
    }
    
    /**
     * @dev Get all supported tokens
     * @return tokens Array of supported token addresses
     */
    function getAllSupportedTokens() external view returns (address[] memory tokens) {
        return supportedTokens;
    }
    
    /**
     * @dev Get contract balances
     * @return contractBalance Native token balance
     * @return gasReserveAmount Gas reserve amount
     * @return distributionAmount Amount available for distribution
     */
    function getContractBalances() external view returns (
        uint256 contractBalance,
        uint256 gasReserveAmount,
        uint256 distributionAmount
    ) {
        contractBalance = address(this).balance;
        gasReserveAmount = gasReserve;
        distributionAmount = contractBalance > gasReserveAmount ? contractBalance - gasReserveAmount : 0;
        
        return (contractBalance, gasReserveAmount, distributionAmount);
    }
    
    /**
     * @dev Pause the contract (emergency)
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }
    
    /**
     * @dev Unpause the contract
     */
    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }
    
    /**
     * @dev Emergency withdraw native tokens (admin only)
     * @param _amount Amount to withdraw
     * @param _reason Reason for emergency withdrawal
     */
    function emergencyWithdrawNative(uint256 _amount, string calldata _reason) external onlyRole(ADMIN_ROLE) {
        if (_amount == 0 || _amount > address(this).balance) {
            revert InvalidAmount();
        }
        
        (bool success, ) = msg.sender.call{value: _amount}("");
        if (!success) {
            revert TransferFailed();
        }
        
        emit EmergencyWithdrawal(msg.sender, _amount, _reason);
    }
    
    /**
     * @dev Emergency withdraw ERC-20 tokens (admin only)
     * @param _tokenAddress The ERC-20 token address
     * @param _amount Amount to withdraw
     * @param _reason Reason for emergency withdrawal
     */
    function emergencyWithdrawERC20(
        address _tokenAddress, 
        uint256 _amount, 
        string calldata _reason
    ) external onlyRole(ADMIN_ROLE) {
        if (_tokenAddress == address(0)) revert ZeroAddress();
        
        IERC20 token = IERC20(_tokenAddress);
        uint256 balance = 0;
        
        // We need try/catch here because it's an external call
        try token.balanceOf(address(this)) returns (uint256 tokenBalance) {
            balance = tokenBalance;
        } catch {
            revert InvalidToken();
        }
        
        if (_amount == 0 || _amount > balance) {
            revert InvalidAmount();
        }
        
        // Use safeTransfer without try/catch
        token.safeTransfer(msg.sender, _amount);
        emit EmergencyTokenWithdrawal(msg.sender, _tokenAddress, _amount, _reason);
    }
    
    /**
     * @dev Receive function to add native tokens to the contract
     */
    receive() external payable {
        // Just accept the ETH
    }
}