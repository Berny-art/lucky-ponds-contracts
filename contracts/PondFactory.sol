// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./PondCore.sol";

/**
 * @title PondFactory
 * @dev Factory contract for easily creating and managing multiple ponds
 * @author Berny Art (HyperFrogs), Modular Version
 */
contract PondFactory is AccessControl {
    // Custom errors
    error ZeroAddress();
    error InvalidParameters();
    error PondCreationFailed();
    error NotAuthorized();

    // Roles - simplified to match PondCore
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant FACTORY_ROLE = keccak256("FACTORY_ROLE");

    // Reference to PondCore contract
    PondCore public immutable pondCore;
    
    // Time constants for better readability
    uint256 private constant FIVE_MINUTES = 5 * 60; // 300 seconds
    uint256 private constant ONE_HOUR = 60 * 60;    // 3600 seconds
    uint256 private constant ONE_DAY = 24 * ONE_HOUR;
    uint256 private constant ONE_WEEK = 7 * ONE_DAY;
    
    // Supported tokens list
    address[] public supportedTokens;
    mapping(address => bool) public isTokenSupported;
    mapping(address => bytes32[]) public tokenPonds;
    
    // Events
    event TokenSupported(address indexed tokenAddress, string symbol);
    event TokenRemoved(address indexed tokenAddress);
    event StandardPondsCreated(
        address indexed tokenAddress, 
        string symbol,
        bytes32[] pondIds,
        string[] pondNames,
        PondCore.PondPeriod[] pondPeriods
    );
    event CustomPondCreated(
        address indexed tokenAddress,
        bytes32 pondId,
        string pondName,
        uint256 startTime,
        uint256 endTime,
        PondCore.PondPeriod pondPeriod
    );

    /**
     * @dev Constructor
     * @param _pondCore Address of the PondCore contract
     */
    constructor(address _pondCore) {
        if(_pondCore == address(0)) revert ZeroAddress();
        
        pondCore = PondCore(payable(_pondCore));
        
        // Setup roles
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(FACTORY_ROLE, msg.sender);
        
        // Add native ETH as a supported token
        address ETH_ADDRESS = address(0);
        supportedTokens.push(ETH_ADDRESS);
        isTokenSupported[ETH_ADDRESS] = true;
        emit TokenSupported(ETH_ADDRESS, "ETH");
    }

    /**
     * @dev Add a new supported token
     * @param _tokenAddress The ERC20 token address
     * @param _symbol The token symbol
     */
    function addSupportedToken(address _tokenAddress, string memory _symbol) external onlyRole(ADMIN_ROLE) {
        if(_tokenAddress == address(0)) revert ZeroAddress();
        if(isTokenSupported[_tokenAddress]) return; // Already supported
        
        supportedTokens.push(_tokenAddress);
        isTokenSupported[_tokenAddress] = true;
        
        emit TokenSupported(_tokenAddress, _symbol);
    }

    /**
     * @dev Remove a token from supported list
     * @param _tokenAddress The token to remove
     */
    function removeSupportedToken(address _tokenAddress) external onlyRole(ADMIN_ROLE) {
        if(!isTokenSupported[_tokenAddress]) return; // Not supported
        
        // Remove from array
        for (uint i = 0; i < supportedTokens.length; i++) {
            if (supportedTokens[i] == _tokenAddress) {
                // Swap with last element and pop
                supportedTokens[i] = supportedTokens[supportedTokens.length - 1];
                supportedTokens.pop();
                break;
            }
        }
        
        // Remove from mapping
        isTokenSupported[_tokenAddress] = false;
        
        emit TokenRemoved(_tokenAddress);
    }

    /**
     * @dev Create standard ponds (5-min, hourly, daily, weekly, monthly) for a token
     * @param _tokenAddress The token address (address(0) for native ETH)
     * @param _symbol The token symbol
     * @param _minTossPrice Minimum toss price
     * @param _maxTotalTossAmount Maximum total toss amount per user
     * @param _pondPeriods Array of pond periods to create
     * @return pondIds Array of created pond IDs
     */
    function createStandardPonds(
        address _tokenAddress, 
        string memory _symbol,
        uint256 _minTossPrice,
        uint256 _maxTotalTossAmount,
        PondCore.PondPeriod[] memory _pondPeriods
    ) external onlyRole(FACTORY_ROLE) returns (bytes32[] memory pondIds) {
        // Validate token
        if (_tokenAddress != address(0) && !isTokenSupported[_tokenAddress]) revert InvalidParameters();
        
        // Determine token type
        PondCore.TokenType tokenType = (_tokenAddress == address(0)) ? 
            PondCore.TokenType.NATIVE : PondCore.TokenType.ERC20;
            
        // Initialize arrays for output
        pondIds = new bytes32[](_pondPeriods.length);
        string[] memory pondNames = new string[](_pondPeriods.length);
        
        // Get current time references
        uint256 nowTime = block.timestamp;
        uint256 today = PondUtils.truncateToDay(nowTime);
        uint256 monday = today - ((PondUtils.getDayOfWeek(nowTime) - 1) * ONE_DAY);
        uint256 firstOfMonth = PondUtils.getFirstOfMonthTimestamp(nowTime);
        uint256 nextMonth = PondUtils.getFirstOfMonthTimestamp(nowTime + 32 days);
        
        // Create requested ponds
        for (uint i = 0; i < _pondPeriods.length; i++) {
            PondCore.PondPeriod period = _pondPeriods[i];
            
            bytes32 pondId;
            string memory pondName;
            uint256 startTime;
            uint256 endTime;
            
            if (period == PondCore.PondPeriod.FIVE_MINUTES) {
                // For 5-minute ponds
                if (tokenType == PondCore.TokenType.NATIVE) {
                    pondId = pondCore.FIVE_MIN_POND_TYPE();
                } else {
                    pondId = keccak256(abi.encodePacked("POND_5MIN", _tokenAddress));
                }
                pondName = string(abi.encodePacked("5-Min ", _symbol, " Pond"));
                startTime = (nowTime / FIVE_MINUTES) * FIVE_MINUTES; // Round to nearest 5 minutes
                endTime = startTime + FIVE_MINUTES - 1;
            }
            else if (period == PondCore.PondPeriod.HOURLY) {
                // For hourly ponds
                if (tokenType == PondCore.TokenType.NATIVE) {
                    pondId = pondCore.HOURLY_POND_TYPE();
                } else {
                    pondId = keccak256(abi.encodePacked("POND_HOURLY", _tokenAddress));
                }
                pondName = string(abi.encodePacked("Hourly ", _symbol, " Pond"));
                startTime = (nowTime / ONE_HOUR) * ONE_HOUR; // Round to current hour
                endTime = startTime + ONE_HOUR - 1;
            }
            else if (period == PondCore.PondPeriod.DAILY) {
                // For daily ponds
                if (tokenType == PondCore.TokenType.NATIVE) {
                    pondId = pondCore.DAILY_POND_TYPE();
                } else {
                    pondId = keccak256(abi.encodePacked("POND_DAILY", _tokenAddress));
                }
                pondName = string(abi.encodePacked("Daily ", _symbol, " Pond"));
                startTime = today;
                endTime = today + ONE_DAY - 1;
            } 
            else if (period == PondCore.PondPeriod.WEEKLY) {
                // For weekly ponds
                if (tokenType == PondCore.TokenType.NATIVE) {
                    pondId = pondCore.WEEKLY_POND_TYPE();
                } else {
                    pondId = keccak256(abi.encodePacked("POND_WEEKLY", _tokenAddress));
                }
                pondName = string(abi.encodePacked("Weekly ", _symbol, " Pond"));
                startTime = monday;
                endTime = monday + ONE_WEEK - 1;
            }
            else if (period == PondCore.PondPeriod.MONTHLY) {
                // For monthly ponds
                if (tokenType == PondCore.TokenType.NATIVE) {
                    pondId = pondCore.MONTHLY_POND_TYPE();
                } else {
                    pondId = keccak256(abi.encodePacked("POND_MONTHLY", _tokenAddress));
                }
                pondName = string(abi.encodePacked("Monthly ", _symbol, " Pond"));
                startTime = firstOfMonth;
                endTime = nextMonth - 1;
            }
            else {
                revert InvalidParameters();
            }
            
            try pondCore.createPond(
                pondId,
                pondName,
                startTime,
                endTime,
                _minTossPrice,
                _maxTotalTossAmount,
                tokenType,
                _tokenAddress,
                period
            ) {
                // Track the created pond
                pondIds[i] = pondId;
                pondNames[i] = pondName;
                
                // Associate with token
                tokenPonds[_tokenAddress].push(pondId);
            } catch {
                revert PondCreationFailed();
            }
        }
        
        emit StandardPondsCreated(
            _tokenAddress, 
            _symbol, 
            pondIds, 
            pondNames, 
            _pondPeriods
        );
        
        return pondIds;
    }

    /**
     * @dev Create a custom pond with specific time parameters
     * @param _tokenAddress The token address (address(0) for native ETH)
     * @param _symbol The token symbol for naming
     * @param _name Custom name for the pond
     * @param _startTime Custom start time
     * @param _endTime Custom end time
     * @param _minTossPrice Minimum toss price
     * @param _maxTotalTossAmount Maximum total toss amount per user
     * @return pondId The ID of the created pond
     */
    function createCustomPond(
        address _tokenAddress,
        string memory _symbol,
        string memory _name,
        uint256 _startTime,
        uint256 _endTime,
        uint256 _minTossPrice,
        uint256 _maxTotalTossAmount
    ) external onlyRole(FACTORY_ROLE) returns (bytes32 pondId) {
        // Validate parameters
        if (_startTime >= _endTime) revert InvalidParameters();
        if (_tokenAddress != address(0) && !isTokenSupported[_tokenAddress]) revert InvalidParameters();
        
        // Determine token type
        PondCore.TokenType tokenType = (_tokenAddress == address(0)) ? 
            PondCore.TokenType.NATIVE : PondCore.TokenType.ERC20;
        
        // Create a unique ID based on parameters
        pondId = keccak256(abi.encodePacked(
            "POND_CUSTOM", 
            _tokenAddress, 
            _startTime, 
            _endTime, 
            block.timestamp
        ));
        
        // Create the pond name if not provided
        string memory pondName = bytes(_name).length > 0 ? 
            _name : 
            string(abi.encodePacked("Custom ", _symbol, " Pond"));
        
        try pondCore.createPond(
            pondId,
            pondName,
            _startTime,
            _endTime,
            _minTossPrice,
            _maxTotalTossAmount,
            tokenType,
            _tokenAddress,
            PondCore.PondPeriod.CUSTOM
        ) {
            // Track the created pond
            tokenPonds[_tokenAddress].push(pondId);
            
            emit CustomPondCreated(
                _tokenAddress,
                pondId,
                pondName,
                _startTime,
                _endTime,
                PondCore.PondPeriod.CUSTOM
            );
            
            return pondId;
        } catch {
            revert PondCreationFailed();
        }
    }

    /**
     * @dev Get token-specific standard pond IDs
     * @param _tokenAddress The address of the token
     * @return fiveMinutePondId The ID of the 5-minute pond for this token
     * @return hourlyPondId The ID of the hourly pond for this token
     * @return dailyPondId The ID of the daily pond for this token
     * @return weeklyPondId The ID of the weekly pond for this token
     * @return monthlyPondId The ID of the monthly pond for this token
     */
    function getTokenStandardPondIds(address _tokenAddress) external view returns (
        bytes32 fiveMinutePondId,
        bytes32 hourlyPondId,
        bytes32 dailyPondId, 
        bytes32 weeklyPondId, 
        bytes32 monthlyPondId
    ) {
        if (_tokenAddress == address(0)) {
            // Native token uses predefined IDs
            return (
                pondCore.FIVE_MIN_POND_TYPE(),
                pondCore.HOURLY_POND_TYPE(),
                pondCore.DAILY_POND_TYPE(),
                pondCore.WEEKLY_POND_TYPE(),
                pondCore.MONTHLY_POND_TYPE()
            );
        } else {
            // ERC20 tokens use deterministic IDs based on address
            fiveMinutePondId = keccak256(abi.encodePacked("POND_5MIN", _tokenAddress));
            hourlyPondId = keccak256(abi.encodePacked("POND_HOURLY", _tokenAddress));
            dailyPondId = keccak256(abi.encodePacked("POND_DAILY", _tokenAddress));
            weeklyPondId = keccak256(abi.encodePacked("POND_WEEKLY", _tokenAddress));
            monthlyPondId = keccak256(abi.encodePacked("POND_MONTHLY", _tokenAddress));
            
            return (fiveMinutePondId, hourlyPondId, dailyPondId, weeklyPondId, monthlyPondId);
        }
    }

    /**
     * @dev Get all ponds for a specific token
     * @param _tokenAddress The token address
     * @return Array of pond IDs
     */
    function getTokenPonds(address _tokenAddress) external view returns (bytes32[] memory) {
        return tokenPonds[_tokenAddress];
    }

    /**
     * @dev Get all supported tokens
     * @return Array of token addresses
     */
    function getAllSupportedTokens() external view returns (address[] memory) {
        return supportedTokens;
    }
}