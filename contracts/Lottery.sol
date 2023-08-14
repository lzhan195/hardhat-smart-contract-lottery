//SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";

error Lottery_NotEnoughETHEntered();
error Lottery_TransferFailed();

contract Lottery is VRFConsumerBaseV2 {
    /* State Variables*/
    uint256 private immutable i_enteranceFee;
    address payable[] private s_players;
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
    bytes32 private immutable i_gasLane;
    uint64 private immutable i_subscriptionId;
    uint32 private immutable i_CallbackGasLimit;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private constant NUM_WORDS = 1;

    /* Lottery Variables */
    address private s_recentWinner;

    /* Events */
    event LotteryEnter(address indexed player);
    event RequestedLotteryWinner(uint256 indexed requestId);
    event WinnnerPicked(address indexed winner);

    constructor(
        address vrfCoordinatorV2,
        uint256 enteranceFee,
        bytes32 gasLane,
        uint64 subscriptionId,
        uint32 callbackGasLimit
    ) VRFConsumerBaseV2(vrfCoordinatorV2) {
        i_enteranceFee = enteranceFee;
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
        i_gasLane = gasLane;
        i_subscriptionId = subscriptionId;
        i_CallbackGasLimit = callbackGasLimit;
    }

    function enterLottery() public payable {
        // require (msg.value > i_enteranceFee, "Not enough ETH!")
        if (msg.value < i_enteranceFee) {
            revert Lottery_NotEnoughETHEntered();
        }
        s_players.push(payable(msg.sender));
        //Emit an event when we update a dynamic array or mapping
        //Named events with the function name reversed
        emit LotteryEnter(msg.sender);
    }

    function requestRandomWinner() external {
        //Resquest the random number
        //Once get it, do something
        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            i_gasLane,
            i_subscriptionId,
            REQUEST_CONFIRMATIONS,
            i_CallbackGasLimit,
            NUM_WORDS
        );
        emit RequestedLotteryWinner(requestId);
    }

    function fulfillRandomWords(
        uint256 /*requestId*/,
        uint256[] memory randomWords
    ) internal override {
        uint256 indexOfWinner = randomWords[0] % s_players.length;
        address payable recentWinner = s_players[indexOfWinner];
        s_recentWinner = recentWinner;
        (bool success, ) = recentWinner.call{value: address(this).balance}("");
        // require(success)
        if (!success) {
            revert Lottery_TransferFailed();
        }
        emit WinnnerPicked(recentWinner);
    }

    /* View / Pure functions */
    function getEnteranceFee() public view returns (uint256) {
        return i_enteranceFee;
    }

    function getPlayer(uint256 index) public view returns (address) {
        return s_players[index];
    }

    function getRecentWinner() public view returns (address) {
        return s_recentWinner;
    }
}
