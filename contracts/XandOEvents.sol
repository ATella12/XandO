// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract XandOEvents {
    event Played(address indexed player, string action);

    mapping(address => uint256) public starts;
    mapping(address => uint256) public playAgains;

    function recordStart() external {
        starts[msg.sender] += 1;
        emit Played(msg.sender, "start");
    }

    function recordPlayAgain() external {
        playAgains[msg.sender] += 1;
        emit Played(msg.sender, "play_again");
    }
}
