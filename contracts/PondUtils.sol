// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PondUtils
 * @dev Utility library for the LuckyPonds system
 * @author Berny Art (HyperFrogs)
 */
library PondUtils {
    /**
     * @dev Convert token amount to standard decimal representation
     * @param _amount Amount with any number of decimals
     * @param _decimals Number of decimals
     * @return Normalized amount with 18 decimals
     */
    function normalizeAmount(uint256 _amount, uint8 _decimals) internal pure returns (uint256) {
        if (_decimals < 18) {
            return _amount * (10 ** (18 - _decimals));
        } else if (_decimals > 18) {
            return _amount / (10 ** (_decimals - 18));
        }
        return _amount;
    }

    /**
     * @dev Truncate a timestamp to the start of the day (00:00:00 UTC)
     * @param _timestamp The timestamp to truncate
     * @return The timestamp at 00:00:00 of the same day
     */
    function truncateToDay(uint256 _timestamp) internal pure returns (uint256) {
        return _timestamp - (_timestamp % 1 days);
    }

    /**
     * @dev Get the day of the week for a timestamp (1=Monday, 7=Sunday)
     * @param _timestamp The timestamp to check
     * @return dayOfWeek Day of the week (1-7)
     */
    function getDayOfWeek(uint256 _timestamp) internal pure returns (uint256 dayOfWeek) {
        // January 1, 1970 was a Thursday (4)
        // So to get Monday (1) as the first day, we add 3 then mod 7 and add 1
        dayOfWeek = ((_timestamp / 86400) + 4) % 7 + 1;
    }

    /**
     * @dev Get timestamp for the first day of the month
     * @param _timestamp The timestamp to use as reference
     * @return Timestamp for the first day of the month
     */
    function getFirstOfMonthTimestamp(uint256 _timestamp) internal pure returns (uint256) {
        (uint256 year, uint256 month, ) = timestampToDate(_timestamp);
        return dateToTimestamp(year, month, 1);
    }

    /**
     * @dev Calculate timestamp for the first day of the next month
     * @param _timestamp The timestamp to use as reference
     * @return Timestamp for the first day of the next month
     */
    function getNextMonthTimestamp(uint256 _timestamp) internal pure returns (uint256) {
        (uint256 year, uint256 month, ) = timestampToDate(_timestamp);
        
        // Move to next month, handle year change
        if (month == 12) {
            year += 1;
            month = 1;
        } else {
            month += 1;
        }
        
        return dateToTimestamp(year, month, 1);
    }

    /**
     * @dev Convert timestamp to date components
     * @param _timestamp The timestamp to convert
     * @return year The year
     * @return month The month (1-12)
     * @return day The day of the month
     */
    function timestampToDate(uint _timestamp) internal pure returns (uint year, uint month, uint day) {
        uint z = _timestamp / 86400 + 719468;
        uint era = (z >= 0 ? z : z - 146096) / 146097;
        uint doe = z - era * 146097;
        uint yoe = (doe - doe/1460 + doe/36524 - doe/146096) / 365;
        year = yoe + era * 400;
        uint doy = doe - (365*yoe + yoe/4 - yoe/100);
        uint mp = (5*doy + 2)/153;
        day = doy - (153*mp+2)/5 + 1;
        month = mp < 10 ? mp + 3 : mp - 9;
        year += (month <= 2) ? 1 : 0;
    }

    /**
     * @dev Convert date components to timestamp
     * @param _year The year
     * @param _month The month (1-12)
     * @param _day The day of month
     * @return timestamp Unix timestamp for the given date
     */
    function dateToTimestamp(uint _year, uint _month, uint _day) internal pure returns (uint timestamp) {
        uint a = (14 - _month) / 12;
        uint y = _year + 4800 - a;
        uint m = _month + 12*a - 3;
        timestamp = _day + (153*m + 2)/5 + 365*y + y/4 - y/100 + y/400 - 32045;
        timestamp = (timestamp - 2440588) * 86400;
    }

    /**
     * @dev Generate a pseudo-random number
     * @param _seed A seed value to increase entropy
     * @param _max The maximum value (exclusive)
     * @return A pseudo-random number between 0 and max-1
     */
    function random(uint256 _seed, uint256 _max) internal view returns (uint256) {
        if (_max == 0) return 0; // Prevent division by zero
        
        return uint256(keccak256(abi.encodePacked(
            block.timestamp,
            block.prevrandao,
            blockhash(block.number - 1),
            _seed
        ))) % _max;
    }

    /**
     * @dev Compare two strings
     * @param a First string
     * @param b Second string
     * @return Whether the strings are equal
     */
    function compareStrings(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(abi.encodePacked(a)) == keccak256(abi.encodePacked(b));
    }
}