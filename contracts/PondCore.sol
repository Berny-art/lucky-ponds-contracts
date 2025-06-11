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
 * @dev Core contract for the Lucky Ponds Lottery.
 * @author Hyper Frogs (Berny Art)
 */
contract PondCore is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

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
    error InvalidParameters();
    error WeightedSelectionFailed();
    error ParticipantLimitExceeded();
    error InvalidBatchSize();

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
     * @dev Optimized Pond struct with packed storage
     */
    struct Pond {
        // Slot 1 (256 bits total) - Time and counters
        uint64 startTime;              // Timestamp when pond opens
        uint64 endTime;                // Timestamp when pond closes  
        uint64 totalTosses;            // Count of tosses in the pond
        uint32 totalParticipants;      // Count of unique participants
        uint32 reserved;               // Reserved for future use
        
        // Slot 2 (256 bits total) - Values
        uint128 totalValue;            // Total value of all tosses
        uint128 totalFrogValue;        // For weighted selection
        
        // Slot 3 (256 bits total) - Limits
        uint128 minTossPrice;          // Minimum toss amount
        uint128 maxTotalTossAmount;    // Maximum total amount per user
        
        // Slot 4 (256 bits total) - Address and flags
        address tokenAddress;          // Zero address for native token (160 bits)
        TokenType tokenType;           // Type of token (8 bits)
        PondPeriod period;             // Period type (8 bits)  
        bool prizeDistributed;         // Whether prize has been distributed (8 bits)
        // 72 bits remaining for future use
        
        // Variable slots
        bytes32 pondType;              // Unique identifier
        string pondName;               // Human-readable name
    }

    /**
     * @dev Packed participant data for gas optimization
     */
    struct PackedParticipant {
        uint128 amount;               // Total amount tossed
        uint128 lastTossIndex;        // Index of their last toss (for faster lookups)
    }

    /**
     * @dev Compressed toss data - packs participant index and value
     */
    struct CompressedToss {
        uint32 participantIndex;      // Index in participantsList
        uint224 value;                // Toss value (supports up to ~2^224 wei)
    }

    /**
     * @dev Structure for returning participant information
     */
    struct ParticipantInfo {
        address participant;
        uint256 tossAmount;
    }

    /**
    * @dev Get standard pond info for UI display
    */
    struct PondDisplayInfo {
        bytes32 pondType;
        string pondName;
        PondPeriod period;
        bool exists;
    }

    // Config values with gas-optimized packing
    struct Config {
        uint128 defaultMinTossPrice;
        uint128 defaultMaxTotalTossAmount;
        uint32 maxParticipantsPerPond;    // NEW: Configurable participant limit
        uint32 emergencyBatchSize;        // NEW: Configurable batch size for emergency operations
        uint32 feePercent;                // Reduced from uint256 to uint32
        uint32 selectionTimelock;         // Reduced from uint256 to uint32
        address feeAddress;
    }
    
    Config public config;

    // Optimized mappings - using packed structs
    mapping(bytes32 => Pond) public ponds;
    mapping(bytes32 => CompressedToss[]) public pondTosses;        // NEW: Array of compressed tosses
    mapping(bytes32 => address[]) public pondParticipants;        // Participants by index
    mapping(bytes32 => mapping(address => PackedParticipant)) public participants;
    mapping(bytes32 => mapping(address => uint32)) public participantIndex; // Address to index mapping
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
        string actionType
    );
    
    event CoinTossed(
        bytes32 indexed pondType,
        address indexed participant, 
        address indexed tokenAddress,
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
        address indexed tokenAddress,  
        uint256 prize, 
        address selector
    );

    event WinnerSelectionDetails(
        bytes32 indexed pondType,
        address indexed winner,
        bytes32 entropySource,
        uint256 randomValue,
        uint256 totalFrogValue,
        uint256 winningThreshold,
        uint256 blockNumber,
        bytes32 blockHash
    );
    
    event ConfigChanged(
        string configType,
        bytes32 indexed pondType,
        uint256 oldValue,
        uint256 newValue,
        address oldAddress,
        address newAddress
    );

    event ParticipantLimitWarning(
        bytes32 indexed pondType, 
        uint256 participantCount, 
        uint256 warningThreshold
    );
    
    event EmergencyAction(
        string actionType,
        address indexed recipient,
        address indexed token,
        uint256 amount,
        bytes32 indexed pondType
    );

    event GasUsageReport(
        string operation,
        uint256 participantCount,
        uint256 gasUsed
    );

    /**
     * @dev Constructor with gas-optimized initialization
     */
    constructor(
        address _feeAddress,
        uint32 _feePercent,
        uint32 _selectionTimelock,
        uint32 _maxParticipantsPerPond
    ) {
        if(_feeAddress == address(0)) revert ZeroAddress();
        if(_feePercent > 10) revert FeeToHigh(); // Max 10%
        
        // Initialize config struct in single SSTORE
        config = Config({
            defaultMinTossPrice: 0.0001 ether,
            defaultMaxTotalTossAmount: 10 ether,
            maxParticipantsPerPond: _maxParticipantsPerPond,
            emergencyBatchSize: 100, // Default batch size
            feePercent: _feePercent,
            selectionTimelock: _selectionTimelock,
            feeAddress: _feeAddress
        });
        
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
     * @dev Create a new pond (unchanged from original)
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
        
        // Validate safe casting
        if (_startTime > type(uint64).max || _endTime > type(uint64).max) revert InvalidParameters();
        if (_minTossPrice > type(uint128).max || _maxTotalTossAmount > type(uint128).max) revert InvalidParameters();
        
        // Create the pond with optimized storage
        Pond memory newPond = Pond({
            startTime: uint64(_startTime),
            endTime: uint64(_endTime),
            totalTosses: 0,
            totalParticipants: 0,
            reserved: 0,
            totalValue: 0,
            totalFrogValue: 0,
            minTossPrice: uint128(_minTossPrice),
            maxTotalTossAmount: uint128(_maxTotalTossAmount),
            tokenType: _tokenType,
            tokenAddress: _tokenAddress,
            period: _period,
            prizeDistributed: false,
            pondType: _pondType,
            pondName: _name
        });
        
        ponds[_pondType] = newPond;
        allPondTypes.push(_pondType);
        
        emit PondAction(_pondType, _name, _startTime, _endTime, "created");
    }

    /**
     * @dev Gas-optimized toss function
     */
    function toss(bytes32 _pondType, uint256 _amount) external payable whenNotPaused nonReentrant {
        uint256 gasStart = gasleft();
        
        Pond storage pond = ponds[_pondType];
        
        // Check if pond exists and is open
        if (pond.endTime == 0) revert InvalidPondType();
        if (block.timestamp < pond.startTime || block.timestamp > pond.endTime) revert PondNotOpen();
        
        // Check participant limit
        if (pond.totalParticipants >= config.maxParticipantsPerPond) {
            revert ParticipantLimitExceeded();
        }
        
        uint256 tossAmount;
        
        // Handle different token types
        if (pond.tokenType == TokenType.NATIVE) {
            if (msg.value < pond.minTossPrice) revert AmountTooLow();
            tossAmount = msg.value;
        } else if (pond.tokenType == TokenType.ERC20) {
            if (_amount < pond.minTossPrice) revert AmountTooLow();
            IERC20 token = IERC20(pond.tokenAddress);
            token.safeTransferFrom(msg.sender, address(this), _amount);
            tossAmount = _amount;
        } else {
            revert TokenNotSupported();
        }
        
        // Check max toss amount
        PackedParticipant storage participant = participants[_pondType][msg.sender];
        uint256 newTotalAmount = participant.amount + tossAmount;
        if (newTotalAmount > pond.maxTotalTossAmount) revert MaxTossAmountExceeded();
        
        // Get or assign participant index - simplified approach
        address[] storage participantsList = pondParticipants[_pondType];
        uint32 participantIdx;
        bool isNewParticipant = false;
        
        // Check if participant already exists
        if (participants[_pondType][msg.sender].amount == 0) {
            // New participant
            participantsList.push(msg.sender);
            participantIdx = uint32(participantsList.length - 1);
            participantIndex[_pondType][msg.sender] = participantIdx;
            pond.totalParticipants++;
            isNewParticipant = true;
            
            // Check for warning threshold (80% of max)
            if (pond.totalParticipants > (config.maxParticipantsPerPond * 80) / 100) {
                emit ParticipantLimitWarning(_pondType, pond.totalParticipants, (config.maxParticipantsPerPond * 80) / 100);
            }
        } else {
            // Existing participant
            participantIdx = participantIndex[_pondType][msg.sender];
        }
        
        // Store compressed toss data with safe casting
        if (tossAmount > type(uint224).max) {
            revert AmountTooLow(); // Reuse existing error for amount validation
        }
        
        pondTosses[_pondType].push(CompressedToss({
            participantIndex: participantIdx,
            value: uint224(tossAmount)
        }));
        
        // Update pond totals
        pond.totalTosses++;
        pond.totalValue += uint128(tossAmount);
        pond.totalFrogValue += uint128(tossAmount);
        
        // Update participant data
        participant.amount += uint128(tossAmount);
        participant.lastTossIndex = uint128(pond.totalTosses - 1);

        // Emit event
        emit CoinTossed(
            _pondType,
            msg.sender,
            pond.tokenAddress,
            tossAmount,
            block.timestamp,
            pond.totalTosses,
            pond.totalValue
        );
        
        // Gas usage reporting
        uint256 gasUsed = gasStart - gasleft();
        emit GasUsageReport("toss", pond.totalParticipants, gasUsed);
    }

    /**
     * @dev Gas-optimized top up function
     */
    function topUpPond(bytes32 _pondType, uint256 _amount) external payable whenNotPaused nonReentrant {
        Pond storage pond = ponds[_pondType];
        
        if (pond.endTime == 0) revert InvalidPondType();
        if (block.timestamp < pond.startTime || block.timestamp > pond.endTime) revert PondNotOpen();
        
        uint256 topUpAmount;
        
        if (pond.tokenType == TokenType.NATIVE) {
            if (msg.value == 0) revert AmountTooLow();
            topUpAmount = msg.value;
        } else if (pond.tokenType == TokenType.ERC20) {
            if (_amount == 0) revert AmountTooLow();
            IERC20 token = IERC20(pond.tokenAddress);
            token.safeTransferFrom(msg.sender, address(this), _amount);
            topUpAmount = _amount;
        } else {
            revert TokenNotSupported();
        }
        
        pond.totalValue += uint128(topUpAmount);
        
        emit PondTopUp(_pondType, msg.sender, topUpAmount, block.timestamp, pond.totalValue);
    }

    /**
     * @dev Gas-optimized winner selection with compressed data
     */
    function selectLuckyWinner(bytes32 _pondType) external nonReentrant whenNotPaused {
        uint256 gasStart = gasleft();
        
        Pond storage pond = ponds[_pondType];
        
        uint256 effectiveTimelock = pond.period == PondPeriod.FIVE_MINUTES 
          ? config.selectionTimelock / 3
          : config.selectionTimelock;

        if (pond.endTime == 0) revert InvalidPondType();
        if (pond.prizeDistributed) revert PrizeAlreadyDistributed();
        if (block.timestamp <= pond.endTime + effectiveTimelock) revert TimelockActive();
        
        if (pond.totalTosses == 0) {
            _resetPond(_pondType);
            return;
        }

        pond.prizeDistributed = true;

        // Gas-optimized winner selection
        address winner = _selectWeightedRandomOptimized(_pondType);

        uint256 fee = (pond.totalValue * config.feePercent) / 100;
        uint256 prize = pond.totalValue - fee;

        // Store winner information
        lastWinner[_pondType] = winner;
        lastPrize[_pondType] = prize;

        _distributePrize(_pondType, winner, prize, fee);

        emit LuckyWinnerSelected(_pondType, winner, pond.tokenAddress, prize, msg.sender);

        _resetPond(_pondType);
        
        // Gas usage reporting
        uint256 gasUsed = gasStart - gasleft();
        emit GasUsageReport("selectWinner", pond.totalParticipants, gasUsed);
    }

    /**
     * @dev Gas-optimized weighted selection using compressed data
     */
    function _selectWeightedRandomOptimized(bytes32 _pondType) internal returns (address) {
        Pond storage pond = ponds[_pondType];
        
        if (pond.totalFrogValue == 0 || pond.totalTosses == 0) {
            return address(0);
        }

        uint256 selectionBlock = block.number;
        bytes32 recentBlockHash = _getRecentBlockhash();
        
        bytes32 entropy = keccak256(abi.encodePacked(
            recentBlockHash,
            block.prevrandao,
            pond.totalTosses,
            pond.totalValue,
            pond.startTime,
            address(this),
            gasleft(),
            tx.gasprice,
            block.timestamp
        ));
        
        uint256 randomValue = uint256(entropy) % pond.totalFrogValue;
        
        // Gas-optimized selection using compressed data
        uint256 cumulativeValue = 0;
        address winner = address(0);
        CompressedToss[] storage tosses = pondTosses[_pondType];
        address[] storage pondParticipantsList = pondParticipants[_pondType];
        
        for (uint256 i = 0; i < tosses.length; i++) {
            cumulativeValue += tosses[i].value;
            
            if (randomValue < cumulativeValue) {
                winner = pondParticipantsList[tosses[i].participantIndex];
                break;
            }
        }
        
        if (winner == address(0)) {
            emit WinnerSelectionDetails(
                _pondType,
                address(0),
                entropy,
                randomValue,
                pond.totalFrogValue,
                cumulativeValue,
                selectionBlock,
                recentBlockHash
            );
            
            revert WeightedSelectionFailed();
        }

        emit WinnerSelectionDetails(
            _pondType,
            winner,
            entropy,
            randomValue,
            pond.totalFrogValue,
            cumulativeValue,
            selectionBlock,
            recentBlockHash
        );
        
        return winner;
    }

    /**
     * @dev Helper function for better blockhash handling
     */
    function _getRecentBlockhash() internal view returns (bytes32) {
        bytes32 hash = blockhash(block.number - 1);
        if (hash == bytes32(0)) {
            hash = blockhash(block.number - 2);
            if (hash == bytes32(0)) {
                return bytes32(block.prevrandao);
            }
        }
        return hash;
    }

    /**
     * @dev Distribute prize and fee (unchanged)
     */
    function _distributePrize(bytes32 _pondType, address _winner, uint256 _prize, uint256 _fee) internal {
        Pond storage pond = ponds[_pondType];
        
        if (pond.tokenType == TokenType.NATIVE) {
            (bool sentWinner, ) = _winner.call{value: _prize}("");
            if (!sentWinner) revert TransferFailed();

            (bool sentFee, ) = config.feeAddress.call{value: _fee}("");
            if (!sentFee) revert TransferFailed();
        } else if (pond.tokenType == TokenType.ERC20) {
            IERC20 token = IERC20(pond.tokenAddress);
            token.safeTransfer(_winner, _prize);
            token.safeTransfer(config.feeAddress, _fee);
        }
    }

    /**
     * @dev Gas-optimized pond reset with batch clearing
     */
    function _resetPond(bytes32 _pondType) internal {
        Pond storage pond = ponds[_pondType];
        
        // Store current data for reuse
        uint128 minTossPrice = pond.minTossPrice;
        uint128 maxTotalAmount = pond.maxTotalTossAmount;
        TokenType tokenType = pond.tokenType;
        address tokenAddress = pond.tokenAddress;
        string memory pondName = pond.pondName;
        PondPeriod period = pond.period;
        
        // Clear data arrays (more gas efficient than individual deletes)
        delete pondTosses[_pondType];
        
        // Clear participant data in batches if too large
        address[] storage pondParticipantsList = pondParticipants[_pondType];
        uint256 participantCount = pondParticipantsList.length;
        
        if (participantCount <= config.emergencyBatchSize) {
            // Small pond - clear everything at once
            for (uint i = 0; i < participantCount; i++) {
                address participant = pondParticipantsList[i];
                delete participants[_pondType][participant];
                delete participantIndex[_pondType][participant];
            }
            delete pondParticipants[_pondType];
        } else {
            // Large pond - mark for batch clearing
            // This would require a separate batch clearing function
            emit EmergencyAction("largePondReset", address(0), address(0), participantCount, _pondType);
        }
        
        // Calculate new time period (unchanged logic)
        uint256 newStartTime;
        uint256 newEndTime;
        uint256 today = PondUtils.truncateToDay(block.timestamp);
        
        if (period == PondPeriod.FIVE_MINUTES) {
            newStartTime = (block.timestamp / FIVE_MINUTES) * FIVE_MINUTES;
            newEndTime = newStartTime + FIVE_MINUTES - 1;
        }
        else if (period == PondPeriod.HOURLY) {
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
            uint256 originalDuration = pond.endTime - pond.startTime;
            newStartTime = block.timestamp;
            newEndTime = block.timestamp + originalDuration;
        }
        
        // Reset the pond with optimized storage
        pond.startTime = uint64(newStartTime);
        pond.endTime = uint64(newEndTime);
        pond.totalTosses = 0;
        pond.totalParticipants = 0;
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
     * @dev Batch clear participants for large ponds
     */
    function batchClearParticipants(bytes32 _pondType, uint256 _startIdx, uint256 _endIdx) 
        external onlyRole(ADMIN_ROLE) {
        if (_startIdx >= _endIdx) revert InvalidParameters();
        
        address[] storage pondParticipantsList = pondParticipants[_pondType];
        if (_endIdx > pondParticipantsList.length) revert InvalidParameters();
        
        for (uint256 i = _startIdx; i < _endIdx; i++) {
            address participant = pondParticipantsList[i];
            delete participants[_pondType][participant];
            delete participantIndex[_pondType][participant];
        }
        
        // If this is the last batch, clear the array
        if (_endIdx == pondParticipantsList.length) {
            delete pondParticipants[_pondType];
        }
    }

    // =========== Configuration Functions ===========

    /**
     * @dev Update maximum participants per pond
     */
    function updateMaxParticipantsPerPond(uint32 _newMaxParticipants) external onlyRole(ADMIN_ROLE) {
        uint32 oldMax = config.maxParticipantsPerPond;
        config.maxParticipantsPerPond = _newMaxParticipants;
        
        emit ConfigChanged("maxParticipantsPerPond", bytes32(0), oldMax, _newMaxParticipants, address(0), address(0));
    }

    /**
     * @dev Update emergency batch size
     */
    function updateEmergencyBatchSize(uint32 _newBatchSize) external onlyRole(ADMIN_ROLE) {
        if (_newBatchSize == 0) revert InvalidParameters();
        
        uint32 oldSize = config.emergencyBatchSize;
        config.emergencyBatchSize = _newBatchSize;
        
        emit ConfigChanged("emergencyBatchSize", bytes32(0), oldSize, _newBatchSize, address(0), address(0));
    }

    /**
     * @dev Update fee percent
     */
    function setFeePercent(uint32 _newFeePercent) external onlyRole(ADMIN_ROLE) {
        if (_newFeePercent > 10) revert FeeToHigh();
        
        uint32 oldPercent = config.feePercent;
        config.feePercent = _newFeePercent;
        
        emit ConfigChanged("feePercent", bytes32(0), oldPercent, _newFeePercent, address(0), address(0));
    }

    /**
     * @dev Set fee address
     */
    function setFeeAddress(address _feeAddress) external onlyRole(ADMIN_ROLE) {
        if (_feeAddress == address(0)) revert ZeroAddress();
        
        address oldAddress = config.feeAddress;
        config.feeAddress = _feeAddress;
        
        emit ConfigChanged("feeAddress", bytes32(0), 0, 0, oldAddress, _feeAddress);
    }

    /**
     * @dev Update selection timelock
     */
    function setSelectionTimelock(uint32 _newTimelock) external onlyRole(ADMIN_ROLE) {
        uint32 oldTimelock = config.selectionTimelock;
        config.selectionTimelock = _newTimelock;
        
        emit ConfigChanged("selectionTimelock", bytes32(0), oldTimelock, _newTimelock, address(0), address(0));
    }

    /**
    * @dev Update minimum toss price for a specific pond
    */
    function updatePondMinTossPrice(bytes32 _pondType, uint128 _newMinTossPrice) external onlyRole(ADMIN_ROLE) {
        Pond storage pond = ponds[_pondType];
        if (pond.endTime == 0) revert InvalidPondType();
        
        uint128 oldMinToss = pond.minTossPrice;
        pond.minTossPrice = _newMinTossPrice;
        
        emit ConfigChanged("pondMinTossPrice", _pondType, oldMinToss, _newMinTossPrice, address(0), address(0));
    }

    /**
    * @dev Update maximum total toss amount for a specific pond
    */
    function updatePondMaxTotalTossAmount(bytes32 _pondType, uint128 _newMaxTotalTossAmount) external onlyRole(ADMIN_ROLE) {
        Pond storage pond = ponds[_pondType];
        if (pond.endTime == 0) revert InvalidPondType();
        
        uint128 oldMaxTotal = pond.maxTotalTossAmount;
        pond.maxTotalTossAmount = _newMaxTotalTossAmount;
        
        emit ConfigChanged("pondMaxTotalTossAmount", _pondType, oldMaxTotal, _newMaxTotalTossAmount, address(0), address(0));
    }

    // =========== Emergency Functions ===========

    /**
     * @dev Gas-optimized emergency refund with configurable batch size
     */
    function emergencyRefundBatch(bytes32 _pondType, uint256 _startIdx, uint256 _endIdx) 
        external onlyRole(ADMIN_ROLE) nonReentrant {
        Pond storage pond = ponds[_pondType];
        
        if (pond.endTime == 0) revert InvalidPondType();
        
        address[] storage allParticipants = pondParticipants[_pondType];
        uint256 totalParticipants = allParticipants.length;
        
        if (_startIdx >= totalParticipants) revert InvalidParameters();
        if (_endIdx > totalParticipants) _endIdx = totalParticipants;
        if (_startIdx >= _endIdx) revert InvalidParameters();
        
        // Check batch size limit
        if ((_endIdx - _startIdx) > config.emergencyBatchSize) revert InvalidBatchSize();
        
        uint256 totalPondValue = pond.totalValue;
        
        for (uint i = _startIdx; i < _endIdx; i++) {
            address participant = allParticipants[i];
            uint256 participantAmount = participants[_pondType][participant].amount;
            
            if (participantAmount > 0) {
                uint256 refundAmount = (participantAmount * totalPondValue) / pond.totalFrogValue;
                
                if (pond.tokenType == TokenType.NATIVE) {
                    (bool success, ) = participant.call{value: refundAmount}("");
                    if (!success) continue;
                } else if (pond.tokenType == TokenType.ERC20) {
                    IERC20 token = IERC20(pond.tokenAddress);
                    try token.transfer(participant, refundAmount) {
                        // Transfer successful
                    } catch {
                        continue;
                    }
                }
                
                emit EmergencyAction("refund", participant, pond.tokenAddress, refundAmount, _pondType);
            }
        }
        
        if (_endIdx == totalParticipants) {
            pond.prizeDistributed = true;
            _resetPond(_pondType);
        }
    }

    /**
     * @dev Emergency reset of a pond
     */
    function emergencyResetPond(bytes32 _pondType) external onlyRole(ADMIN_ROLE) {
        Pond storage pond = ponds[_pondType];
        if (pond.endTime == 0) revert InvalidPondType();
        
        _resetPond(_pondType);
        
        emit EmergencyAction("pondReset", address(0), address(0), 0, _pondType);
    }

    /**
     * @dev Remove a custom pond (gas optimized)
     */
    function removePond(bytes32 _pondType) external onlyRole(ADMIN_ROLE) {
        Pond storage pond = ponds[_pondType];
        if (pond.endTime == 0) revert InvalidPondType();
        
        if (_isStandardPond(_pondType)) {
            revert StandardPondNotRemovable();
        }

        if (pond.totalTosses > 0) {
            revert CannotRemovePondWithActivity();
        }
                
        string memory pondName = pond.pondName;
        
        // Gas-optimized cleanup
        delete pondTosses[_pondType];
        
        address[] storage allParticipantsList = pondParticipants[_pondType];
        for (uint i = 0; i < allParticipantsList.length; i++) {
            delete participants[_pondType][allParticipantsList[i]];
            delete participantIndex[_pondType][allParticipantsList[i]];
        }
        
        delete ponds[_pondType];
        delete pondParticipants[_pondType];
        
        _removeFromArray(_pondType);
        
        emit PondAction(_pondType, pondName, 0, 0, "removed");
    }
    
    /**
     * @dev Remove pond type from array (gas optimized)
     */
    function _removeFromArray(bytes32 _pondType) internal {
        uint256 length = allPondTypes.length;
        for (uint i = 0; i < length; i++) {
            if (allPondTypes[i] == _pondType) {
                allPondTypes[i] = allPondTypes[length - 1];
                allPondTypes.pop();
                break;
            }
        }
    }

    /**
     * @dev Check if pond type is standard
     */
    function _isStandardPond(bytes32 _pondType) internal view returns (bool) {
        return _pondType == FIVE_MIN_POND_TYPE ||
               _pondType == HOURLY_POND_TYPE ||
               _pondType == DAILY_POND_TYPE || 
               _pondType == WEEKLY_POND_TYPE || 
               _pondType == MONTHLY_POND_TYPE;
    }

    // =========== Upkeep Functions ===========

    /**
     * @dev Check if upkeep is needed
     */
    function checkUpkeep(bytes calldata) external view returns (bool upkeepNeeded, bytes memory performData) {
        for (uint i = 0; i < allPondTypes.length; i++) {
            bytes32 pondType = allPondTypes[i];
            Pond storage pond = ponds[pondType];
            
            uint256 effectiveTimelock = pond.period == PondPeriod.FIVE_MINUTES 
                ? config.selectionTimelock / 3 
                : config.selectionTimelock;
                
            if (!pond.prizeDistributed && 
                block.timestamp > pond.endTime + effectiveTimelock) {
                return (true, abi.encode(pondType));
            }
        }
        return (false, "");
    }

    /**
     * @dev Perform upkeep
     */
    function performUpkeep(bytes calldata performData) external {
        bytes32 pondType = abi.decode(performData, (bytes32));
        this.selectLuckyWinner(pondType);
    }

    /**
     * @dev Pause/unpause functions
     */
    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // =========== View Functions (Gas Optimized) ===========

    /**
     * @dev Get standard pond types
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
     * @dev Get all pond types
     */
    function getAllPondTypes() external view returns (bytes32[] memory) {
        return allPondTypes;
    }

    /**
     * @dev Get pond participants (gas optimized)
     */
    function getPondParticipants(bytes32 _pondType) external view returns (ParticipantInfo[] memory) {
        address[] memory allParticipants = pondParticipants[_pondType];
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
     * @dev Get user toss amount
     */
    function getUserTossAmount(bytes32 _pondType, address _user) external view returns (uint256) {
        return participants[_pondType][_user].amount;
    }
    
    /**
     * @dev Get comprehensive pond status (gas optimized)
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
        
        if (pond.endTime == 0) revert InvalidPondType();
        
        uint256 _timeUntilEnd = block.timestamp < pond.endTime 
            ? pond.endTime - block.timestamp 
            : 0;
        
        return (
            pond.pondName,
            pond.startTime,
            pond.endTime,
            pond.totalTosses,
            pond.totalValue,
            pond.totalParticipants,
            pond.prizeDistributed,
            _timeUntilEnd,
            pond.minTossPrice,
            pond.maxTotalTossAmount,
            pond.tokenType,
            pond.tokenAddress,
            pond.period
        );
    }

    /**
     * @dev Get standard ponds for UI (gas optimized)
     */
    function getStandardPondsForUI(address _tokenAddress) external view returns (PondDisplayInfo[] memory) {
        PondDisplayInfo[] memory result = new PondDisplayInfo[](5);
        
        if (_tokenAddress == address(0)) {
            result[0] = _getPondInfoIfExists(FIVE_MIN_POND_TYPE, "5-Min Pond", PondPeriod.FIVE_MINUTES);
            result[1] = _getPondInfoIfExists(HOURLY_POND_TYPE, "Hourly Pond", PondPeriod.HOURLY);
            result[2] = _getPondInfoIfExists(DAILY_POND_TYPE, "Daily Pond", PondPeriod.DAILY);
            result[3] = _getPondInfoIfExists(WEEKLY_POND_TYPE, "Weekly Pond", PondPeriod.WEEKLY);
            result[4] = _getPondInfoIfExists(MONTHLY_POND_TYPE, "Monthly Pond", PondPeriod.MONTHLY);
        } else {
            bytes32 fiveMinType = keccak256(abi.encodePacked("POND_5MIN", _tokenAddress));
            bytes32 hourlyType = keccak256(abi.encodePacked("POND_HOURLY", _tokenAddress));
            bytes32 dailyType = keccak256(abi.encodePacked("POND_DAILY", _tokenAddress));
            bytes32 weeklyType = keccak256(abi.encodePacked("POND_WEEKLY", _tokenAddress));
            bytes32 monthlyType = keccak256(abi.encodePacked("POND_MONTHLY", _tokenAddress));
            
            string memory symbol = "Token";
            try IERC20Metadata(_tokenAddress).symbol() returns (string memory s) {
                symbol = s;
            } catch {
                // Use default "Token"
            }
            
            result[0] = _getPondInfoIfExists(fiveMinType, string(abi.encodePacked("5-Min ", symbol, " Pond")), PondPeriod.FIVE_MINUTES);
            result[1] = _getPondInfoIfExists(hourlyType, string(abi.encodePacked("Hourly ", symbol, " Pond")), PondPeriod.HOURLY);
            result[2] = _getPondInfoIfExists(dailyType, string(abi.encodePacked("Daily ", symbol, " Pond")), PondPeriod.DAILY);
            result[3] = _getPondInfoIfExists(weeklyType, string(abi.encodePacked("Weekly ", symbol, " Pond")), PondPeriod.WEEKLY);
            result[4] = _getPondInfoIfExists(monthlyType, string(abi.encodePacked("Monthly ", symbol, " Pond")), PondPeriod.MONTHLY);
        }
        
        return result;
    }

    /**
     * @dev Helper function to get pond info if exists
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
     * @dev Get current configuration
     */
    function getConfig() external view returns (Config memory) {
        return config;
    }

    /**
     * @dev Receive function
     */
    receive() external payable {}
}