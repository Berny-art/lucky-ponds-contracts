// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./PondUtils.sol";

/**
 * @title PondCore
 * @dev Core contract for the LuckyPonds system
 * @author Berny Art (HyperFrogs), Modular Version
 */
contract PondCore is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Custom errors for gas efficiency
    error ZeroAddress();
    error InvalidPondType();
    error PondNotOpen();
    error PondNotEnded();
    error PrizeAlreadyDistributed();
    error NoPondParticipants();
    error TransferFailed();
    error TokenNotSupported();
    error TimelockActive();
    error AmountTooLow();
    error MaxTossAmountExceeded();
    error PondAlreadyExists();
    error StandardPondNotRemovable();
    error CannotRemovePondWithActivity();
    error FeeToHigh();

    // Roles
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant POND_MANAGER_ROLE = keccak256("POND_MANAGER_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    // Token types and pond periods
    enum TokenType { NATIVE, ERC20 }
    enum PondPeriod { FIVE_MINUTES, HOURLY, DAILY, WEEKLY, MONTHLY, CUSTOM }

    // Time constants for better readability
    uint256 private constant FIVE_MINUTES = 5 * 60; // 300 seconds
    uint256 private constant ONE_HOUR = 60 * 60;    // 3600 seconds

    // Standard pond identifiers
    bytes32 public immutable FIVE_MIN_POND_TYPE;
    bytes32 public immutable HOURLY_POND_TYPE;
    bytes32 public immutable DAILY_POND_TYPE;
    bytes32 public immutable WEEKLY_POND_TYPE;
    bytes32 public immutable MONTHLY_POND_TYPE;

    /**
     * @dev Pond struct containing all the data for a specific pond
     */
    struct Pond {
        // Slot 1 (256 bits total)
        uint64 startTime;              // Timestamp when pond opens
        uint64 endTime;                // Timestamp when pond closes
        uint64 totalTosses;            // Count of tosses in the pond
        uint64 paddingA;               // Reserved for future use
        
        // Slot 2 (256 bits total)
        uint128 totalValue;            // Total value of all tosses
        uint128 totalFrogValue;        // For weighted selection
        
        // Slot 3 (256 bits total)
        uint64 minTossPrice;           // Minimum toss amount
        uint64 paddingB;               // Reserved for future use
        uint128 maxTotalTossAmount;    // Maximum total amount per user
        
        // Slot 4 (160 bits + enum + enum + bool)
        address tokenAddress;          // Zero address for native token
        TokenType tokenType;           // Type of token (native or ERC20)
        PondPeriod period;             // Period type (daily, weekly, etc.)
        bool prizeDistributed;         // Whether prize has been distributed
        
        // Slot 5+ (variable size)
        bytes32 pondType;              // Unique identifier
        string pondName;               // Human-readable name
    }
    /**
    * @dev Get standard pond info for UI display
    * @param _tokenAddress The token address (address(0) for native ETH)
    * @return An array of pond information with types, names, and periods
    */
    struct PondDisplayInfo {
        bytes32 pondType;
        string pondName;
        PondPeriod period;
        bool exists;
    }

    /**
     * @dev Participant information
     */
    struct Participant {
        uint256 amount;               // Total amount tossed
        bool exists;                  // Whether user has participated
    }

    /**
     * @dev Structure for returning participant information
     */
    struct ParticipantInfo {
        address participant;
        uint256 tossAmount;
    }

    // Config values
    uint256 public defaultMinTossPrice;
    uint256 public defaultMaxTotalTossAmount;
    uint256 public feePercent;
    uint256 public selectionTimelock;
    address public feeAddress;

    // Mappings
    mapping(bytes32 => Pond) public ponds;
    mapping(bytes32 => mapping(uint256 => address)) public pondParticipants;
    mapping(bytes32 => mapping(uint256 => uint256)) public pondValues;
    mapping(bytes32 => mapping(address => Participant)) public participants;
    mapping(bytes32 => address[]) private participantsList;
    mapping(bytes32 => address) public lastWinner;
    mapping(bytes32 => uint256) public lastPrize;
    
    // All pond types for iteration
    bytes32[] public allPondTypes;

    // Events
    event PondAction(
        bytes32 indexed pondType, 
        string name, 
        uint256 startTime, 
        uint256 endTime, 
        string actionType  // "created", "reset", "removed"
    );
    
    event CoinTossed(
        bytes32 indexed pondType,
        address indexed participant, 
        uint256 amount,
        uint256 timestamp, 
        uint256 totalPondTosses, 
        uint256 totalPondValue
    );
    
    event PondTopUp(
        bytes32 indexed pondType,
        address indexed contributor, 
        uint256 amount,
        uint256 timestamp, 
        uint256 totalPondValue
    );
    
    event LuckyWinnerSelected(
        bytes32 indexed pondType, 
        address indexed winner, 
        uint256 prize, 
        address selector
    );
    
    event ConfigChanged(
        string configType,         // Type of config change
        bytes32 indexed pondType,  // Zero bytes for global settings
        uint256 oldValue,          // Old numeric value or 0 for address changes
        uint256 newValue,          // New numeric value or 0 for address changes
        address oldAddress,        // Old address or zero address for numeric changes
        address newAddress         // New address or zero address for numeric changes
    );
    
    event EmergencyAction(
        string actionType,             // "withdraw", "tokenWithdraw", "pondReset"
        address indexed recipient,     // Recipient of funds or zero address for resets
        address indexed token,         // Token address or zero address for ETH/resets
        uint256 amount,                // Amount withdrawn or 0 for resets
        bytes32 indexed pondType       // Pond type for resets or zero bytes for withdrawals
    );

    /**
     * @dev Constructor initializes the contract with fee address and settings
     * @param _feeAddress Address where fees will be sent
     * @param _feePercent Fee percentage (out of 100)
     * @param _selectionTimelock Time to wait after pond ends before selecting winner (in seconds)
     */
    constructor(
        address _feeAddress,
        uint256 _feePercent,
        uint256 _selectionTimelock
    ) {
        if(_feeAddress == address(0)) revert ZeroAddress();
        
        feeAddress = _feeAddress;
        feePercent = _feePercent;
        selectionTimelock = _selectionTimelock;
        
        // Set default values
        defaultMinTossPrice = 0.0001 ether;
        defaultMaxTotalTossAmount = 10 ether;
        
        // Initialize standard pond IDs
        FIVE_MIN_POND_TYPE = keccak256(abi.encodePacked("POND_5MIN"));
        HOURLY_POND_TYPE = keccak256(abi.encodePacked("POND_HOURLY"));
        DAILY_POND_TYPE = keccak256(abi.encodePacked("POND_DAILY"));
        WEEKLY_POND_TYPE = keccak256(abi.encodePacked("POND_WEEKLY"));
        MONTHLY_POND_TYPE = keccak256(abi.encodePacked("POND_MONTHLY"));
        
        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(POND_MANAGER_ROLE, msg.sender);
    }

    /**
     * @dev Create a new pond
     * @param _pondType Unique identifier for the pond
     * @param _name Human-readable name for the pond
     * @param _startTime Start time for the pond
     * @param _endTime End time for the pond
     * @param _minTossPrice Minimum price per toss
     * @param _maxTotalTossAmount Maximum total amount allowed per user
     * @param _tokenType Type of token accepted (native or ERC20)
     * @param _tokenAddress Address of ERC20 token (zero address for native)
     * @param _period Period type (hourly, daily, weekly, monthly, custom)
     */
    function createPond(
        bytes32 _pondType,
        string memory _name,
        uint256 _startTime,
        uint256 _endTime,
        uint256 _minTossPrice,
        uint256 _maxTotalTossAmount,
        TokenType _tokenType,
        address _tokenAddress,
        PondPeriod _period
    ) external onlyRole(FACTORY_ROLE) {
        // Check if pond already exists
        if (ponds[_pondType].endTime != 0) revert PondAlreadyExists();
        
        // Validate token settings
        if (_tokenType == TokenType.ERC20 && _tokenAddress == address(0)) revert ZeroAddress();
        
        // Create the pond with optimized storage
        Pond memory newPond = Pond({
            startTime: uint64(_startTime),
            endTime: uint64(_endTime),
            totalTosses: 0,
            paddingA: 0,
            totalValue: 0,
            totalFrogValue: 0,
            minTossPrice: uint64(_minTossPrice),
            paddingB: 0,
            maxTotalTossAmount: uint128(_maxTotalTossAmount),
            tokenType: _tokenType,
            tokenAddress: _tokenAddress,
            period: _period,
            prizeDistributed: false,
            pondType: _pondType,
            pondName: _name
        });
        
        ponds[_pondType] = newPond;
        
        // Add to the list of all ponds
        allPondTypes.push(_pondType);
        
        // Emit event
        emit PondAction(_pondType, _name, _startTime, _endTime, "created");
    }

    /**
     * @dev Unified function to toss coins/tokens into a pond
     * @param _pondType The type of pond to toss into
     * @param _amount Amount of tokens to toss (ignored for native currency)
     */
    function toss(bytes32 _pondType, uint256 _amount) external payable whenNotPaused nonReentrant {
        Pond storage pond = ponds[_pondType];
        
        // Check if pond exists
        if (pond.endTime == 0) revert InvalidPondType();
        
        // Check if pond is open
        if (block.timestamp < pond.startTime || block.timestamp > pond.endTime) revert PondNotOpen();
        
        uint256 tossAmount;
        
        // Handle different token types
        if (pond.tokenType == TokenType.NATIVE) {
            // Check amount meets minimum
            if (msg.value < pond.minTossPrice) revert AmountTooLow();
            tossAmount = msg.value;
        } else if (pond.tokenType == TokenType.ERC20) {
            // Check amount meets minimum
            if (_amount < pond.minTossPrice) revert AmountTooLow();
            
            // Transfer tokens from user to contract
            IERC20 token = IERC20(pond.tokenAddress);
            token.safeTransferFrom(msg.sender, address(this), _amount);
            tossAmount = _amount;
        } else {
            revert TokenNotSupported();
        }
        
        // Check max toss amount
        uint256 currentAmount = participants[_pondType][msg.sender].amount;
        uint256 newTotalAmount = currentAmount + tossAmount;
        if (newTotalAmount > pond.maxTotalTossAmount) revert MaxTossAmountExceeded();
        
        // Store participant and value for selection
        uint64 currentToss = pond.totalTosses;
        pondParticipants[_pondType][currentToss] = msg.sender;
        pondValues[_pondType][currentToss] = tossAmount;
        
        // Update pond totals
        pond.totalTosses = currentToss + 1;
        pond.totalValue += uint128(tossAmount);
        pond.totalFrogValue += uint128(tossAmount);
        
        // Track user participation
        Participant storage participant = participants[_pondType][msg.sender];
        participant.amount += tossAmount;
        
        // Add to unique participants list if first time
        if (!participant.exists) {
            participantsList[_pondType].push(msg.sender);
            participant.exists = true;
        }

        // Emit event
        emit CoinTossed(
            _pondType,
            msg.sender,
            tossAmount,
            block.timestamp,
            pond.totalTosses,
            pond.totalValue
        );
    }

    /**
     * @dev Top up a pond's reward pool without becoming a participant
     * @param _pondType The type of pond to top up
     * @param _amount Amount of tokens to top up (ignored for native currency)
     */
    function topUpPond(bytes32 _pondType, uint256 _amount) external payable whenNotPaused nonReentrant {
        Pond storage pond = ponds[_pondType];
        
        // Check if pond exists
        if (pond.endTime == 0) revert InvalidPondType();
        
        // Check if pond is open
        if (block.timestamp < pond.startTime || block.timestamp > pond.endTime) revert PondNotOpen();
        
        uint256 topUpAmount;
        
        // Handle different token types
        if (pond.tokenType == TokenType.NATIVE) {
            // Check proper amount was sent
            if (msg.value == 0) revert AmountTooLow();
            topUpAmount = msg.value;
        } else if (pond.tokenType == TokenType.ERC20) {
            // Check amount is meaningful
            if (_amount == 0) revert AmountTooLow();
            
            // Transfer tokens from user to contract
            IERC20 token = IERC20(pond.tokenAddress);
            token.safeTransferFrom(msg.sender, address(this), _amount);
            topUpAmount = _amount;
        } else {
            revert TokenNotSupported();
        }
        
        // Add to total value (but not to totalTosses or totalFrogValue)
        pond.totalValue += uint128(topUpAmount);
        
        // Emit event
        emit PondTopUp(
            _pondType,
            msg.sender,
            topUpAmount,
            block.timestamp,
            pond.totalValue
        );
    }

    /**
     * @dev Select a lucky winner and distribute the prize
     * @param _pondType The pond type to select a winner for
     */
    function selectLuckyWinner(bytes32 _pondType) external nonReentrant whenNotPaused {
        Pond storage pond = ponds[_pondType];
        
        uint256 effectiveTimelock = pond.period == PondPeriod.FIVE_MINUTES 
          ? selectionTimelock / 3  // Shorter timelock for 5-min ponds
          : selectionTimelock;

        // Check if pond exists
        if (pond.endTime == 0) revert InvalidPondType();
        
        // Check if prize already distributed
        if (pond.prizeDistributed) revert PrizeAlreadyDistributed();

        // Check if pond has ended and timelock has passed
        if (block.timestamp <= pond.endTime + effectiveTimelock) revert TimelockActive();
        
        // Check if pond has participants
        if (pond.totalTosses == 0) {
            _resetPond(_pondType);
            return;
        }

        // Mark as distributed before transfer to prevent reentrancy
        pond.prizeDistributed = true;

        // Select winner using weighted random selection
        address winner = _selectWeightedRandom(_pondType);

        // Calculate prize and fee
        uint256 fee = (pond.totalValue * feePercent) / 100;
        uint256 prize = pond.totalValue - fee;

        // Store winner information
        lastWinner[_pondType] = winner;
        lastPrize[_pondType] = prize;

        // Distribute prize and fee
        _distributePrize(_pondType, winner, prize, fee);

        // Emit event
        emit LuckyWinnerSelected(_pondType, winner, prize, msg.sender);

        // Reset the pond
        _resetPond(_pondType);
    }

    /**
     * @dev Internal function to select a winner using weighted random selection
     * @param _pondType The pond type to select from
     * @return winner address
     */
    function _selectWeightedRandom(bytes32 _pondType) internal view returns (address) {
        Pond storage pond = ponds[_pondType];
        
        if (pond.totalFrogValue == 0) return address(0);
        
        // Generate a random value
        uint256 randomValue = uint256(keccak256(abi.encodePacked(
            block.timestamp,
            block.prevrandao,
            blockhash(block.number - 1),
            pond.totalTosses
        ))) % pond.totalFrogValue;
        
        // Weighted selection based on toss amounts
        uint256 cumulativeValue = 0;
        
        for (uint256 i = 0; i < pond.totalTosses; i++) {
            cumulativeValue += pondValues[_pondType][i];
            if (randomValue < cumulativeValue) {
                return pondParticipants[_pondType][i];
            }
        }
        
        // Fallback - should never reach here if logic is correct
        return pondParticipants[_pondType][0];
    }

    /**
     * @dev Distribute prize and fee
     * @param _pondType The pond type
     * @param _winner The winner address
     * @param _prize The prize amount
     * @param _fee The fee amount
     */
    function _distributePrize(bytes32 _pondType, address _winner, uint256 _prize, uint256 _fee) internal {
        Pond storage pond = ponds[_pondType];
        
        if (pond.tokenType == TokenType.NATIVE) {
            // Send prize to winner
            (bool sentWinner, ) = _winner.call{value: _prize}("");
            if (!sentWinner) revert TransferFailed();

            // Send fee to fee address
            (bool sentFee, ) = feeAddress.call{value: _fee}("");
            if (!sentFee) revert TransferFailed();
        } else if (pond.tokenType == TokenType.ERC20) {
            // Send ERC20 tokens
            IERC20 token = IERC20(pond.tokenAddress);
            token.safeTransfer(_winner, _prize);
            token.safeTransfer(feeAddress, _fee);
        }
    }

    /**
     * @dev Reset a pond after a winner is selected
     * @param _pondType The pond type to reset
     */
    function _resetPond(bytes32 _pondType) internal {
        Pond storage pond = ponds[_pondType];
        
        // Store current data for reuse
        uint64 minTossPrice = pond.minTossPrice;
        uint128 maxTotalAmount = pond.maxTotalTossAmount;
        TokenType tokenType = pond.tokenType;
        address tokenAddress = pond.tokenAddress;
        string memory pondName = pond.pondName;
        PondPeriod period = pond.period;
        
        // Clear participants data
        address[] memory allParticipants = participantsList[_pondType];
        for (uint i = 0; i < allParticipants.length; i++) {
            delete participants[_pondType][allParticipants[i]];
        }
        delete participantsList[_pondType];
        
        // Calculate new time period
        uint256 newStartTime;
        uint256 newEndTime;
        uint256 today = PondUtils.truncateToDay(block.timestamp);
        
        if (period == PondPeriod.FIVE_MINUTES) {
            // Round to the nearest 5 minutes
            newStartTime = (block.timestamp / FIVE_MINUTES) * FIVE_MINUTES;
            newEndTime = newStartTime + FIVE_MINUTES - 1;
        }
        else if (period == PondPeriod.HOURLY) {
            // Round to the nearest hour (existing code)
            newStartTime = (block.timestamp / ONE_HOUR) * ONE_HOUR;
            newEndTime = newStartTime + ONE_HOUR - 1;
        }
        else if (period == PondPeriod.DAILY) {
            newStartTime = today;
            newEndTime = today + 1 days - 1;
        } 
        else if (period == PondPeriod.WEEKLY) {
            uint256 dayOfWeek = PondUtils.getDayOfWeek(block.timestamp);
            uint256 monday = today - ((dayOfWeek - 1) * 1 days);
            newStartTime = monday;
            newEndTime = monday + 7 days - 1;
        } 
        else if (period == PondPeriod.MONTHLY) {
            newStartTime = PondUtils.getFirstOfMonthTimestamp(block.timestamp);
            newEndTime = PondUtils.getFirstOfMonthTimestamp(block.timestamp + 32 days) - 1;
        }
        else {
            // For custom ponds, extend by the original duration
            uint256 originalDuration = pond.endTime - pond.startTime;
            newStartTime = block.timestamp;
            newEndTime = block.timestamp + originalDuration;
        }
        
        // Reset the pond with optimized storage
        pond.startTime = uint64(newStartTime);
        pond.endTime = uint64(newEndTime);
        pond.totalTosses = 0;
        pond.totalValue = 0;
        pond.totalFrogValue = 0;
        pond.prizeDistributed = false;
        pond.minTossPrice = minTossPrice;
        pond.maxTotalTossAmount = maxTotalAmount;
        pond.tokenType = tokenType;
        pond.tokenAddress = tokenAddress;
        pond.pondName = pondName;
        pond.period = period;
        
        emit PondAction(_pondType, pondName, newStartTime, newEndTime, "reset");
    }

    /**
     * @dev Remove a custom pond that is no longer needed
     * @param _pondType The type identifier of the pond to remove
     * @notice This can only remove custom ponds with no activity
     */
    function removePond(bytes32 _pondType) external onlyRole(ADMIN_ROLE) {
        // Check if pond exists
        Pond storage pond = ponds[_pondType];
        if (pond.endTime == 0) revert InvalidPondType();
        
        // Check if it's a standard pond (which can't be removed)
        if (_isStandardPond(_pondType)) {
            revert StandardPondNotRemovable();
        }

        // Check if the pond has any activity (tosses)
        if (pond.totalTosses > 0) {
            revert CannotRemovePondWithActivity();
        }
                
        // Store name for event
        string memory pondName = pond.pondName;
        
        // Clean up user data
        address[] memory allParticipants = participantsList[_pondType];
        for (uint i = 0; i < allParticipants.length; i++) {
            delete participants[_pondType][allParticipants[i]];
        }
        
        // Remove the pond
        delete ponds[_pondType];
        
        // Remove from the allPondTypes array using swap and pop for gas efficiency
        _removeFromArray(_pondType);
        
        // Clear participant data
        delete participantsList[_pondType];
        
        // Emit removal event
        emit PondAction(_pondType, pondName, 0, 0, "removed");
    }
    
    /**
     * @dev Remove a pond type from the allPondTypes array
     * @param _pondType The pond type to remove
     */
    function _removeFromArray(bytes32 _pondType) internal {
        for (uint i = 0; i < allPondTypes.length; i++) {
            if (allPondTypes[i] == _pondType) {
                // Swap with the last element and pop (gas efficient removal)
                allPondTypes[i] = allPondTypes[allPondTypes.length - 1];
                allPondTypes.pop();
                break;
            }
        }
    }

    /**
     * @dev Check if a pond type is a standard pond
     * @param _pondType The pond type to check
     * @return True if it's a standard pond
     */
    function _isStandardPond(bytes32 _pondType) internal view returns (bool) {
        return _pondType == FIVE_MIN_POND_TYPE ||
               _pondType == HOURLY_POND_TYPE ||
               _pondType == DAILY_POND_TYPE || 
               _pondType == WEEKLY_POND_TYPE || 
               _pondType == MONTHLY_POND_TYPE;
    }

    // =========== Configuration Functions ===========

    /**
     * @dev Update the minimum toss price for a specific pond
     * @param _pondType The pond type to update
     * @param _newMinPrice The new minimum toss price
     */
    function updateMinTossPrice(bytes32 _pondType, uint256 _newMinPrice) external onlyRole(POND_MANAGER_ROLE) {
        Pond storage pond = ponds[_pondType];
        
        // Check if pond exists
        if (pond.endTime == 0) revert InvalidPondType();
        
        uint256 oldPrice = pond.minTossPrice;
        pond.minTossPrice = uint64(_newMinPrice);
        
        emit ConfigChanged("minTossPrice", _pondType, oldPrice, _newMinPrice, address(0), address(0));
    }

    /**
     * @dev Update the maximum total toss amount per user for a specific pond
     * @param _pondType The pond type to update
     * @param _newMaxAmount The new maximum total amount per user
     */
    function updateMaxTotalTossAmount(bytes32 _pondType, uint256 _newMaxAmount) external onlyRole(POND_MANAGER_ROLE) {
        Pond storage pond = ponds[_pondType];
        
        // Check if pond exists
        if (pond.endTime == 0) revert InvalidPondType();
        
        uint256 oldMax = pond.maxTotalTossAmount;
        pond.maxTotalTossAmount = uint128(_newMaxAmount);
        
        emit ConfigChanged("maxTotalTossAmount", _pondType, oldMax, _newMaxAmount, address(0), address(0));
    }

    /**
     * @dev Update the default minimum toss price for new ponds
     * @param _newDefaultMinPrice The new default minimum toss price
     */
    function updateDefaultMinTossPrice(uint256 _newDefaultMinPrice) external onlyRole(POND_MANAGER_ROLE) {
        uint256 oldPrice = defaultMinTossPrice;
        defaultMinTossPrice = _newDefaultMinPrice;
        
        emit ConfigChanged("defaultMinTossPrice", bytes32(0), oldPrice, _newDefaultMinPrice, address(0), address(0));
    }

    /**
     * @dev Update the default maximum total toss amount for new ponds
     * @param _newDefaultMaxAmount The new default maximum total amount
     */
    function updateDefaultMaxTotalTossAmount(uint256 _newDefaultMaxAmount) external onlyRole(POND_MANAGER_ROLE) {
        uint256 oldMax = defaultMaxTotalTossAmount;
        defaultMaxTotalTossAmount = _newDefaultMaxAmount;
        
        emit ConfigChanged("defaultMaxTotalTossAmount", bytes32(0), oldMax, _newDefaultMaxAmount, address(0), address(0));
    }

    /**
     * @dev Set the fee address
     * @param _feeAddress The new fee address
     */
    function setFeeAddress(address _feeAddress) external onlyRole(ADMIN_ROLE) {
        if (_feeAddress == address(0)) revert ZeroAddress();
        
        address oldAddress = feeAddress;
        feeAddress = _feeAddress;
        
        emit ConfigChanged("feeAddress", bytes32(0), 0, 0, oldAddress, _feeAddress);
    }

    /**
     * @dev Update the fee percent
     * @param _newFeePercent The new fee percentage (out of 100)
     */
    function setFeePercent(uint256 _newFeePercent) external onlyRole(ADMIN_ROLE) {
        if (_newFeePercent > 10) revert FeeToHigh(); // Max 10%
        
        uint256 oldPercent = feePercent;
        feePercent = _newFeePercent;
        
        emit ConfigChanged("feePercent", bytes32(0), oldPercent, _newFeePercent, address(0), address(0));
    }

    /**
     * @dev Update the selection timelock period
     * @param _newTimelock The new timelock period in seconds
     */
    function setSelectionTimelock(uint256 _newTimelock) external onlyRole(ADMIN_ROLE) {
        uint256 oldTimelock = selectionTimelock;
        selectionTimelock = _newTimelock;
        
        emit ConfigChanged("selectionTimelock", bytes32(0), oldTimelock, _newTimelock, address(0), address(0));
    }

    /**
     * @dev Pause the contract
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
     * @dev Emergency withdraw of native currency
     */
    function emergencyWithdraw() external onlyRole(ADMIN_ROLE) {
        uint256 amount = address(this).balance;
        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
        
        emit EmergencyAction("withdraw", msg.sender, address(0), amount, bytes32(0));
    }

    /**
     * @dev Emergency withdraw of ERC20 tokens
     * @param _token The ERC20 token to withdraw
     */
    function emergencyWithdrawTokens(address _token) external onlyRole(ADMIN_ROLE) {
        IERC20 token = IERC20(_token);
        uint256 balance = token.balanceOf(address(this));
        token.safeTransfer(msg.sender, balance);
        
        emit EmergencyAction("tokenWithdraw", msg.sender, _token, balance, bytes32(0));
    }

    /**
     * @dev Emergency reset of a pond
     * @param _pondType The pond type to reset
     */
    function emergencyResetPond(bytes32 _pondType) external onlyRole(ADMIN_ROLE) {
        Pond storage pond = ponds[_pondType];
        if (pond.endTime == 0) revert InvalidPondType();
        
        // Reset the pond even if it's in a bad state
        _resetPond(_pondType);
        
        emit EmergencyAction("pondReset", address(0), address(0), 0, _pondType);
    }

    // =========== View Functions ===========

    /**
    * @dev Get all standard pond types for reference
    * @return fiveMin 5-minute pond identifier
    * @return hourly Hourly pond identifier 
    * @return daily Daily pond identifier
    * @return weekly Weekly pond identifier
    * @return monthly Monthly pond identifier
    */
    function getStandardPondTypes() external view returns (
        bytes32 fiveMin, 
        bytes32 hourly, 
        bytes32 daily, 
        bytes32 weekly, 
        bytes32 monthly
    ) {
        return (
            FIVE_MIN_POND_TYPE, 
            HOURLY_POND_TYPE, 
            DAILY_POND_TYPE, 
            WEEKLY_POND_TYPE, 
            MONTHLY_POND_TYPE
        );
    }

    /**
     * @dev Get all pond types that have been created
     * @return Array of all pond type identifiers
     */
    function getAllPondTypes() external view returns (bytes32[] memory) {
        return allPondTypes;
    }

    /**
     * @dev Get all participants for a specific pond with their toss amounts
     * @param _pondType The pond type to query
     * @return Array of participant info with addresses and toss amounts
     */
    function getPondParticipants(bytes32 _pondType) external view returns (ParticipantInfo[] memory) {
        address[] memory allParticipants = participantsList[_pondType];
        ParticipantInfo[] memory result = new ParticipantInfo[](allParticipants.length);
        
        for (uint i = 0; i < allParticipants.length; i++) {
            address participant = allParticipants[i];
            result[i] = ParticipantInfo(
                participant,
                participants[_pondType][participant].amount
            );
        }
        
        return result;
    }
    
    /**
     * @dev Get user toss amount for a specific pond
     * @param _pondType The pond type to query
     * @param _user The user address to query
     * @return Total amount tossed by this user in the specified pond
     */
    function getUserTossAmount(bytes32 _pondType, address _user) external view returns (uint256) {
        return participants[_pondType][_user].amount;
    }
    
    /**
     * @dev Get comprehensive pond status
     * @param _pondType The pond type to query
     * @return name The name of the pond
     * @return startTime The start time of the pond period
     * @return endTime The end time of the pond period
     * @return totalTosses The total number of tosses in the pond
     * @return totalValue The total value collected in the pond
     * @return totalParticipants The number of unique participants
     * @return prizeDistributed Whether the prize has been distributed
     * @return timeUntilEnd Time remaining until the pond ends
     * @return minTossPrice Minimum price per toss
     * @return maxTotalTossAmount Maximum total toss amount per user
     * @return tokenType Type of token accepted by the pond
     * @return tokenAddress Address of ERC20 token (if applicable)
     * @return period Pond period type
     */
    function getPondStatus(bytes32 _pondType) external view returns (
        string memory name,
        uint256 startTime,
        uint256 endTime,
        uint256 totalTosses,
        uint256 totalValue,
        uint256 totalParticipants,
        bool prizeDistributed,
        uint256 timeUntilEnd,
        uint256 minTossPrice,
        uint256 maxTotalTossAmount,
        TokenType tokenType,
        address tokenAddress,
        PondPeriod period
    ) {
        Pond storage pond = ponds[_pondType];
        
        // Check if pond exists
        if (pond.endTime == 0) revert InvalidPondType();
        
        uint256 _timeUntilEnd;
        if (block.timestamp < pond.endTime) {
            _timeUntilEnd = pond.endTime - block.timestamp;
        } else {
            _timeUntilEnd = 0;
        }
        
        return (
            pond.pondName,
            pond.startTime,
            pond.endTime,
            pond.totalTosses,
            pond.totalValue,
            participantsList[_pondType].length,
            pond.prizeDistributed,
            _timeUntilEnd,
            pond.minTossPrice,
            pond.maxTotalTossAmount,
            pond.tokenType,
            pond.tokenAddress,
            pond.period
        );
    }

    function getStandardPondsForUI(address _tokenAddress) external view returns (PondDisplayInfo[] memory) {
    PondDisplayInfo[] memory result = new PondDisplayInfo[](5); // 5 standard types: 5min, hourly, daily, weekly, monthly
    
    // For native token, use predefined IDs
    if (_tokenAddress == address(0)) {
        // Check if ponds exist and get names
        result[0] = _getPondInfoIfExists(FIVE_MIN_POND_TYPE, "5-Min ETH Pond", PondPeriod.FIVE_MINUTES);
        result[1] = _getPondInfoIfExists(HOURLY_POND_TYPE, "Hourly ETH Pond", PondPeriod.HOURLY);
        result[2] = _getPondInfoIfExists(DAILY_POND_TYPE, "Daily ETH Pond", PondPeriod.DAILY);
        result[3] = _getPondInfoIfExists(WEEKLY_POND_TYPE, "Weekly ETH Pond", PondPeriod.WEEKLY);
        result[4] = _getPondInfoIfExists(MONTHLY_POND_TYPE, "Monthly ETH Pond", PondPeriod.MONTHLY);
    } else {
        // Generate types for ERC20 token
        bytes32 fiveMinType = keccak256(abi.encodePacked("POND_5MIN", _tokenAddress));
        bytes32 hourlyType = keccak256(abi.encodePacked("POND_HOURLY", _tokenAddress));
        bytes32 dailyType = keccak256(abi.encodePacked("POND_DAILY", _tokenAddress));
        bytes32 weeklyType = keccak256(abi.encodePacked("POND_WEEKLY", _tokenAddress));
        bytes32 monthlyType = keccak256(abi.encodePacked("POND_MONTHLY", _tokenAddress));
        
        // Get the token symbol if available (fallback to "Token" if not)
        string memory symbol = "Token";
        try IERC20Metadata(_tokenAddress).symbol() returns (string memory s) {
            symbol = s;
        } catch {
            // If symbol() call fails, just use "Token"
        }
        
        // Check if ponds exist and get names
        result[0] = _getPondInfoIfExists(fiveMinType, string(abi.encodePacked("5-Min ", symbol, " Pond")), PondPeriod.FIVE_MINUTES);
        result[1] = _getPondInfoIfExists(hourlyType, string(abi.encodePacked("Hourly ", symbol, " Pond")), PondPeriod.HOURLY);
        result[2] = _getPondInfoIfExists(dailyType, string(abi.encodePacked("Daily ", symbol, " Pond")), PondPeriod.DAILY);
        result[3] = _getPondInfoIfExists(weeklyType, string(abi.encodePacked("Weekly ", symbol, " Pond")), PondPeriod.WEEKLY);
        result[4] = _getPondInfoIfExists(monthlyType, string(abi.encodePacked("Monthly ", symbol, " Pond")), PondPeriod.MONTHLY);
    }
    
    return result;
}

    /**
    * @dev Helper function to get pond info if it exists
    * @param _pondType The pond type to check
    * @param _defaultName Default name to use if pond doesn't exist
    * @param _period The period of the pond
    * @return Pond display info with existence flag
    */
    function _getPondInfoIfExists(bytes32 _pondType, string memory _defaultName, PondPeriod _period) internal view returns (PondDisplayInfo memory) {
        Pond storage pond = ponds[_pondType];
        bool exists = pond.endTime != 0;
        
        return PondDisplayInfo({
            pondType: _pondType,
            pondName: exists ? pond.pondName : _defaultName,
            period: _period,
            exists: exists
        });
    }

    /**
     * @dev Allow the contract to receive native currency
     */
    receive() external payable {}
}