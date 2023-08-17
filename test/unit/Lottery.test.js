const { network, getNamedAccounts, ethers } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");
const { assert, expect, AssertionError } = require("chai");

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Lottery Unit Tests", function () {
        let lottery, VRFCoordinatorV2Mock, lotteryEntranceFee, deployer, interval
        const chainId = network.config.chainId

        beforeEach(async function () {
            deployer = (await getNamedAccounts()).deployer
            await deployments.fixture(["all"])
            lottery = await ethers.getContract("Lottery", deployer)
            VRFCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
            lotteryEntranceFee = await lottery.getEntranceFee()
            interval = await lottery.getInterval()
        })

        describe("constructor", function () {
            it("initializes the lottery correctly", async function () {
                const lotteryState = await lottery.getLotteryState()
                assert.equal(lotteryState.toString(), "0")
                assert.equal(interval.toString(), networkConfig[chainId]["interval"])
            })
        })

        describe("enterLottery", function () {
            it("reverts when you don't pay enough", async function () {
                await expect(lottery.enterLottery()).to.be.revertedWith(
                    "Lottery_NotEnoughETHEntered")
            })
            it("records players when they enter", async function () {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                const playerFromContract = await lottery.getPlayer(0)
                assert.equal(playerFromContract, deployer)
            })
            it("emits event on enter", async function () {
                await expect(lottery.enterLottery({ value: lotteryEntranceFee })).to.emit(
                    lottery,
                    "LotteryEnter"
                )
            })
            it("it donesn't allow entrance when lottery is calculating", async function () {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])

                await lottery.performUpkeep([])
                await expect(lottery.enterLottery({ value: lotteryEntranceFee })).to.be.revertedWith(
                    "Lottery_NotOpen"
                )
            })
        })
        describe("checkUpkeep", function () {
            it("returns false if people haven't sent any ETH", async function () {
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                assert(!upkeepNeeded)
            })
            it("returns false if lottery iesn't open", async function () {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                await lottery.performUpkeep("0x")
                const lotteryState = await lottery.getLotteryState()
                const { upkeepNeeded } = await lottery.callStatic.checkUpkeep([])
                assert.equal(lotteryState.toString(), "1")
                assert.equal(upkeepNeeded, false)
            })
            it("returns false if enough time hasn't passed", async () => {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() - 5]) // use a higher number here if this test fails
                await network.provider.request({ method: "evm_mine", params: [] })
                const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                assert(!upkeepNeeded)
            })
            it("returns true if enough time has passed, has players, eth, and is open", async () => {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
                const { upkeepNeeded } = await lottery.callStatic.checkUpkeep("0x") // upkeepNeeded = (timePassed && isOpen && hasBalance && hasPlayers)
                assert(upkeepNeeded)
            })
        })
        describe("performUpkeep", function () {
            it("it can only run if checkupkeep is true", async function () {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                const tx = await lottery.performUpkeep([])
                console.log(tx)
                assert(tx)
            })
            it("reverts when checkupkeep is false", async function () {
                await expect(lottery.performUpkeep([])).to.be.revertedWith(
                    "Lottery_UpkeepNotNeeded"
                )
            })
            it("updates the lottery state, emits and event, and calls the vrf coordinator", async function () {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
                const txResponse = await lottery.performUpkeep([])
                const txReceipt = await txResponse.wait(1)
                const requestId = txReceipt.events[1].args.requestId
                const lotteryState = await lottery.getLotteryState()
                assert(requestId.toNumber() > 0)
                assert(lotteryState.toString() == 1)
            })
        })
        describe("fulfillRandomWords", function () {
            beforeEach(async function () {
                await lottery.enterLottery({ value: lotteryEntranceFee })
                await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                await network.provider.send("evm_mine", [])
            })
            it("can only be called after performUpkeep", async function () {
                await expect(VRFCoordinatorV2Mock.fulfillRandomWords(0, lottery.address)).to.be.revertedWith("nonexistent request")
                await expect(VRFCoordinatorV2Mock.fulfillRandomWords(1, lottery.address)).to.be.revertedWith("nonexistent request")
            })
            // BIG TEST
            it("picks a winner, resets the lottery, and sends money", async function () {
                const additionalEntrants = 3
                const startingAccountIndex = 1
                for (let i = startingAccountIndex; i < startingAccountIndex + additionalEntrants; i++) {
                    const accountConnectedLottery = lottery.connect(accounts[i])
                    await accountConnectedLottery.enterLottery({ value: lotteryEntranceFee })
                }
                const startingTimeStamp = await lottery.getLastTimeStamp()

                //performUpkeep (mock being chainlink keepers)
                //fulfillRandomWords (mock being the chainlink vrf)
                //we will have to wait for the fulfilRandomWords to be called
                await new Promise(async (resolve, reject) => {
                    lottery.once("winnerPicked", async () => {
                        console.log("Found the event!")
                        try {
                            const recentWinner = await lottery.getRecentWinner()
                            const lotteryState = await lottery.getLotteryState()
                            const endingTimeStamp = await lottery.getLastTimeStamp()
                            const numPlayers = await lottery.getNumberOfPlayers()
                            const winnerEndingBalance = await accounts[1].getBalance()
                            assert.equal(numPlayers.toString(), "0")
                            assert.equal(lotteryState.toString(), "0")
                            assert(endingTimeStamp > startingTimeStamp)

                            assert.equal(
                                winnerEndingBalance.toString(),
                                winnerStartingBalance.add(
                                    lotteryEntranceFee
                                        .mul(additionalEntrants)
                                        .add(lotteryEntranceFee)
                                        .toString()
                                )
                            )
                        } catch (e) {
                            reject(e)
                        }
                        resolve()
                    })
                    //Setting up the listener
                    //below, we will fire the event, and the listener will pick it up, and resolve
                    const tx = await lottery.performUpkeep([])
                    const txReceipt = await tx.wait(1)
                    const winnerStartingBalance = await accounts[1].getBalance()
                    await VRFCoordinatorV2Mock.fulfillRandomWords(
                        txReceipt.events[1].args.requestId,
                        lottery.address
                    )
                })
            })
        })
    })