import {
  Commitment,
  Connection,
  Finality,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { Program, Provider } from "@coral-xyz/anchor";
import { GlobalAccount } from "./globalAccount";
import {
  CompleteEvent,
  CreateEvent,
  CreateTokenMetadata,
  PriorityFee,
  PumpFunEventHandlers,
  PumpFunEventType,
  SetParamsEvent,
  TradeEvent,
  TransactionResult,
} from "./types";
import {
  toCompleteEvent,
  toCreateEvent,
  toSetParamsEvent,
  toTradeEvent,
} from "./events";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BondingCurveAccount } from "./bondingCurveAccount";
import { BN } from "bn.js";
import {
  DEFAULT_COMMITMENT,
  DEFAULT_FINALITY,
  calculateWithSlippageBuy,
  calculateWithSlippageSell,
  sendTx,
} from "./util";
import { PumpFun, IDL } from "./IDL";
const PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const MPL_TOKEN_METADATA_PROGRAM_ID =
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

export const GLOBAL_ACCOUNT_SEED = "global";
export const MINT_AUTHORITY_SEED = "mint-authority";
export const BONDING_CURVE_SEED = "bonding-curve";
export const METADATA_SEED = "metadata";

export const DEFAULT_DECIMALS = 6;

const staticAccounts = {
  global: new PublicKey("4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"),
  systemProgram: new PublicKey("11111111111111111111111111111111"),
  tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
  token2022Program: new PublicKey(
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
  ),
  eventAuthority: new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1"),
  associatedProgramId: new PublicKey([
    140, 151, 37, 143, 78, 36, 137, 241, 187, 61, 16, 41, 20, 142, 13, 131, 11,
    90, 19, 153, 218, 255, 16, 132, 4, 142, 123, 216, 219, 233, 248, 89,
  ]),
  mayhemProgramId: new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e"),
  programId: new PublicKey(PROGRAM_ID),
  globalVolumeAccumulator: new PublicKey(
    "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y"
  ),
  feeConfig: new PublicKey("8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt"),
  feeProgram: new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ"),
  mayhemFeeRecipient: new PublicKey(
    "GesfTA3X2arioaHp8bbKdjG9vJtskViWACZoYvxp4twS"
  ),
};

const staticBuffers = {
  bondingCurve: Buffer.from("bonding-curve"),
  creatorVault: Buffer.from("creator-vault"),
  seed: Buffer.from([
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172,
    28, 180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
  ]),
  token2022: TOKEN_2022_PROGRAM_ID.toBuffer(),
  tokenProgram: TOKEN_PROGRAM_ID.toBuffer(),
  userVolumeAccumulator: Buffer.from("user_volume_accumulator"),
};

export class PumpFunSDK {
  public program: Program<PumpFun>;
  public connection: Connection;
  constructor(provider?: Provider) {
    this.program = new Program<PumpFun>(IDL as PumpFun, provider);
    this.connection = this.program.provider.connection;
  }

  async createAndBuy(
    creator: Keypair,
    mint: Keypair,
    createTokenMetadata: CreateTokenMetadata,
    buyAmountSol: bigint,
    slippageBasisPoints: bigint = 500n,
    priorityFees?: PriorityFee,
    commitment: Commitment = DEFAULT_COMMITMENT,
    finality: Finality = DEFAULT_FINALITY
  ): Promise<TransactionResult> {
    let tokenMetadata = await this.createTokenMetadata(createTokenMetadata);

    let createTx = await this.getCreateInstructions(
      creator.publicKey,
      createTokenMetadata.name,
      createTokenMetadata.symbol,
      tokenMetadata.metadataUri,
      mint
    );

    let newTx = new Transaction().add(createTx);

    if (buyAmountSol > 0) {
      const globalAccount = await this.getGlobalAccount(commitment);
      const buyAmount = globalAccount.getInitialBuyPrice(buyAmountSol);
      const buyAmountWithSlippage = calculateWithSlippageBuy(
        buyAmountSol,
        slippageBasisPoints
      );

      // @ts-ignore
      const buyTx = await this.getBuyInstructions(
        creator.publicKey,
        mint.publicKey,
        globalAccount.feeRecipient,
        buyAmount,
        buyAmountWithSlippage
      );

      newTx.add(buyTx);
    }

    let createResults = await sendTx(
      this.connection,
      newTx,
      creator.publicKey,
      [creator, mint],
      priorityFees,
      commitment,
      finality
    );
    return createResults;
  }

  async buy(
    buyer: Keypair,
    mint: PublicKey,
    buyAmountSol: bigint,
    slippageBasisPoints: bigint = 500n,
    priorityFees?: PriorityFee,
    commitment: Commitment = DEFAULT_COMMITMENT,
    finality: Finality = DEFAULT_FINALITY,
    skipPreflight: boolean = false,
    cachedData?: {
      blockHash?: string;
      bondingCurveAccount?: BondingCurveAccount;
      globalAccount?: GlobalAccount;
      forceCreateAssociatedTokenAccount?: boolean;
    }
  ): Promise<TransactionResult> {
    let buyTx = await this.getBuyInstructionsBySolAmount(
      buyer.publicKey,
      mint,
      buyAmountSol,
      slippageBasisPoints,
      commitment,
      cachedData?.bondingCurveAccount,
      cachedData?.globalAccount,
      cachedData?.forceCreateAssociatedTokenAccount
    );

    let buyResults = await sendTx(
      this.connection,
      buyTx,
      buyer.publicKey,
      [buyer],
      priorityFees,
      commitment,
      finality,
      skipPreflight,
      cachedData?.blockHash
    );
    return buyResults;
  }

  async sell(
    seller: Keypair,
    mint: PublicKey,
    sellTokenAmount: bigint,
    slippageBasisPoints: bigint = 500n,
    priorityFees?: PriorityFee,
    commitment: Commitment = DEFAULT_COMMITMENT,
    finality: Finality = DEFAULT_FINALITY,
    skipPreflight: boolean = false,
    cachedData?: {
      blockHash?: string;
      bondingCurveAccount?: BondingCurveAccount;
      globalAccount?: GlobalAccount;
    }
  ): Promise<TransactionResult> {
    let sellTx = await this.getSellInstructionsByTokenAmount(
      seller.publicKey,
      mint,
      sellTokenAmount,
      slippageBasisPoints,
      commitment,
      cachedData?.bondingCurveAccount,
      cachedData?.globalAccount
    );

    let sellResults = await sendTx(
      this.connection,
      sellTx,
      seller.publicKey,
      [seller],
      priorityFees,
      commitment,
      finality,
      skipPreflight,
      cachedData?.blockHash
    );
    return sellResults;
  }

  //create token instructions
  async getCreateInstructions(
    creator: PublicKey,
    name: string,
    symbol: string,
    uri: string,
    mint: Keypair
  ) {
    const mplTokenMetadata = new PublicKey(MPL_TOKEN_METADATA_PROGRAM_ID);

    const [metadataPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from(METADATA_SEED),
        mplTokenMetadata.toBuffer(),
        mint.publicKey.toBuffer(),
      ],
      mplTokenMetadata
    );

    const associatedBondingCurve = getAssociatedTokenAddressSync(
      mint.publicKey,
      this.getBondingCurvePDA(mint.publicKey),
      true
    );

    return (
      this.program.methods
        // @ts-ignore
        .create(name, symbol, uri)
        .accounts({
          mint: mint.publicKey,
          // @ts-ignore
          associatedBondingCurve: associatedBondingCurve,
          metadata: metadataPDA,
          user: creator,
        })
        .signers([mint])
        .transaction()
    );
  }

  async getBuyInstructionsBySolAmount(
    buyer: PublicKey,
    mint: PublicKey,
    buyAmountSol: bigint,
    slippageBasisPoints: bigint = 500n,
    commitment: Commitment = DEFAULT_COMMITMENT,
    bondingCurveAccount?: BondingCurveAccount | null,
    globalAccount?: GlobalAccount,
    forceCreateAssociatedTokenAccount: boolean = false
  ) {
    if (!bondingCurveAccount) {
      bondingCurveAccount = await this.getBondingCurveAccount(mint, commitment);
    }

    if (!bondingCurveAccount) {
      throw new Error(`Bonding curve account not found: ${mint.toBase58()}`);
    }

    let buyAmount = bondingCurveAccount.getBuyPrice(buyAmountSol);
    let buyAmountWithSlippage = calculateWithSlippageBuy(
      buyAmountSol,
      slippageBasisPoints
    );

    let feeRecipient;
    if (bondingCurveAccount.isMayhemMode) {
      feeRecipient = staticAccounts.mayhemFeeRecipient;
    } else {
      if (!globalAccount) {
        globalAccount = await this.getGlobalAccount(commitment);
      }
      feeRecipient = globalAccount.feeRecipient;
    }

    return await this.getBuyInstructions(
      buyer,
      mint,
      feeRecipient,
      buyAmount,
      buyAmountWithSlippage,
      commitment,
      forceCreateAssociatedTokenAccount,
      bondingCurveAccount.creator,
      bondingCurveAccount.isMayhemMode
    );
  }

  getBuyInstructionsBySolAmountSync(
    buyer: PublicKey,
    mint: PublicKey,
    buyAmountSol: bigint,
    slippageBasisPoints: bigint = 500n,
    commitment: Commitment = DEFAULT_COMMITMENT,
    bondingCurveAccount: BondingCurveAccount,
    globalAccount: GlobalAccount,
    forceCreateAssociatedTokenAccount: boolean = false
  ) {
    let buyAmount = bondingCurveAccount.getBuyPrice(buyAmountSol);
    let buyAmountWithSlippage = calculateWithSlippageBuy(
      buyAmountSol,
      slippageBasisPoints
    );

    return this.getBuyInstructionsSync(
      buyer,
      mint,
      globalAccount.feeRecipient,
      buyAmount,
      buyAmountWithSlippage,
      commitment,
      forceCreateAssociatedTokenAccount,
      bondingCurveAccount.creator,
      bondingCurveAccount.isMayhemMode
    );
  }

  creatorVaultPda(creator: PublicKey) {
    const [creatorVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("creator-vault"), creator.toBuffer()],
      this.program.programId
    );
    return creatorVault;
  }

  //buy
  async getBuyInstructions(
    buyer: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    amount: bigint,
    solAmount: bigint,
    commitment: Commitment = DEFAULT_COMMITMENT,
    forceCreateAssociatedTokenAccount = false,
    bondingCurveCreator: PublicKey,
    isMayhemMode: boolean
  ) {
    const tokenProgram = isMayhemMode
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;
    const associatedUser = getAssociatedTokenAddressSync(
      mint,
      buyer,
      false,
      tokenProgram
    );

    let transaction = new Transaction();

    try {
      if (forceCreateAssociatedTokenAccount)
        throw "Forced associated account creation";
      await getAccount(this.connection, associatedUser, commitment);
    } catch (e) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          buyer,
          associatedUser,
          buyer,
          mint,
          tokenProgram
        )
      );
    }

    transaction.add(
      await this.program.methods
        .buy(new BN(amount.toString()), new BN(solAmount.toString()), {
          0: true,
        })
        .accountsPartial({
          feeRecipient: feeRecipient,
          mint: mint,
          associatedUser: associatedUser,
          user: buyer,
          creatorVault: this.creatorVaultPda(bondingCurveCreator),
        })
        .transaction()
    );

    return transaction;
  }

  // buy sync
  getBuyInstructionsSync(
    buyer: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    amount: bigint,
    solAmount: bigint,
    commitment: Commitment = DEFAULT_COMMITMENT,
    createAssociatedTokenAccount = true,
    bondingCurveCreator: PublicKey,
    isMayhemMode: boolean
  ) {
    const [associatedUser] = PublicKey.findProgramAddressSync(
      [
        buyer.toBuffer(),
        isMayhemMode ? staticBuffers.token2022 : staticBuffers.tokenProgram,
        mint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    let ataIns;

    if (createAssociatedTokenAccount) {
      ataIns = createAssociatedTokenAccountIdempotentInstruction(
        buyer,
        associatedUser,
        buyer,
        mint,
        isMayhemMode ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID
      );
    }

    const data = this.program.coder.instruction.encode("buy", {
      amount: new BN(amount.toString()),
      maxSolCost: new BN(solAmount.toString()),
      trackVolume: { some: true },
    });

    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [staticBuffers.bondingCurve, mint.toBuffer()],
      this.program.programId
    );

    const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
      [
        bondingCurve.toBuffer(),
        isMayhemMode ? staticBuffers.token2022 : staticBuffers.seed,
        mint.toBuffer(),
      ],
      staticAccounts.associatedProgramId
    );

    const [creatorVault] = PublicKey.findProgramAddressSync(
      [staticBuffers.creatorVault, bondingCurveCreator.toBuffer()],
      this.program.programId
    );

    const [userVolumeAccumulator] = PublicKey.findProgramAddressSync(
      [staticBuffers.userVolumeAccumulator, buyer.toBuffer()],
      this.program.programId
    );

    const keys = [
      {
        pubkey: staticAccounts.global,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: isMayhemMode ? staticAccounts.mayhemFeeRecipient : feeRecipient,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: mint,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: bondingCurve,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: associatedBondingCurve,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: associatedUser,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: buyer,
        isSigner: true,
        isWritable: true,
      },
      {
        pubkey: staticAccounts.systemProgram,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: isMayhemMode
          ? staticAccounts.token2022Program
          : staticAccounts.tokenProgram,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: creatorVault,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: staticAccounts.eventAuthority,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: staticAccounts.programId,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: staticAccounts.globalVolumeAccumulator,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: userVolumeAccumulator,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: staticAccounts.feeConfig,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: staticAccounts.feeProgram,
        isSigner: false,
        isWritable: false,
      },
    ];

    const buyIns = new TransactionInstruction({
      programId: this.program.programId,
      keys,
      data,
    });

    return ataIns ? [ataIns, buyIns] : [buyIns];
  }

  //sell
  async getSellInstructionsByTokenAmount(
    seller: PublicKey,
    mint: PublicKey,
    sellTokenAmount: bigint,
    slippageBasisPoints: bigint = 500n,
    commitment: Commitment = DEFAULT_COMMITMENT,
    bondingCurveAccount?: BondingCurveAccount | null,
    globalAccount?: GlobalAccount
  ) {
    if (!bondingCurveAccount) {
      bondingCurveAccount = await this.getBondingCurveAccount(mint, commitment);
    }

    if (!bondingCurveAccount) {
      throw new Error(`Bonding curve account not found: ${mint.toBase58()}`);
    }

    if (!globalAccount) {
      globalAccount = await this.getGlobalAccount(commitment);
    }

    let minSolOutput = bondingCurveAccount.getSellPrice(
      sellTokenAmount,
      globalAccount.feeBasisPoints
    );

    let sellAmountWithSlippage = calculateWithSlippageSell(
      minSolOutput,
      slippageBasisPoints
    );

    let feeRecipient;
    if (bondingCurveAccount.isMayhemMode) {
      feeRecipient = staticAccounts.mayhemFeeRecipient;
    } else {
      feeRecipient = globalAccount.feeRecipient;
    }

    return await this.getSellInstructions(
      seller,
      mint,
      feeRecipient,
      sellTokenAmount,
      sellAmountWithSlippage,
      bondingCurveAccount.isMayhemMode,
    );
  }

  //sell sync
  getSellInstructionsByTokenAmountSync(
    seller: PublicKey,
    mint: PublicKey,
    sellTokenAmount: bigint,
    slippageBasisPoints: bigint = 500n,
    commitment: Commitment = DEFAULT_COMMITMENT,
    bondingCurveAccount: BondingCurveAccount,
    globalAccount: GlobalAccount
  ) {
    let minSolOutput = bondingCurveAccount.getSellPrice(
      sellTokenAmount,
      globalAccount.feeBasisPoints
    );

    let sellAmountWithSlippage = calculateWithSlippageSell(
      minSolOutput,
      slippageBasisPoints
    );

    return this.getSellInstructionsSync(
      seller,
      mint,
      globalAccount.feeRecipient,
      sellTokenAmount,
      sellAmountWithSlippage,
      bondingCurveAccount.creator,
      bondingCurveAccount.isMayhemMode
    );
  }

  async getSellInstructions(
    seller: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    amount: bigint,
    minSolOutput: bigint,
    isMayhemMode: boolean,
  ) {
    const tokenProgram = isMayhemMode ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    const associatedUser = getAssociatedTokenAddressSync(mint, seller, false, tokenProgram);

    let transaction = new Transaction();

    transaction.add(
      await this.program.methods
        .sell(new BN(amount.toString()), new BN(minSolOutput.toString()))
        .accountsPartial({
          feeRecipient: feeRecipient,
          mint: mint,
          associatedUser: associatedUser,
          user: seller,
        })
        .transaction()
    );

    return transaction;
  }

  // sell sync
  getSellInstructionsSync(
    seller: PublicKey,
    mint: PublicKey,
    feeRecipient: PublicKey,
    amount: bigint,
    minSolOutput: bigint,
    bondingCurveCreator: PublicKey,
    isMayhemMode: boolean
  ) {
    const [associatedUser] = PublicKey.findProgramAddressSync(
      [
        seller.toBuffer(),
        isMayhemMode ? staticBuffers.token2022 : staticBuffers.tokenProgram,
        mint.toBuffer(),
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const data = this.program.coder.instruction.encode("sell", {
      amount: new BN(amount.toString()),
      minSolOutput: new BN(minSolOutput.toString()),
    });

    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [staticBuffers.bondingCurve, mint.toBuffer()],
      this.program.programId
    );

    const [associatedBondingCurve] = PublicKey.findProgramAddressSync(
      [
        bondingCurve.toBuffer(),
        isMayhemMode ? staticBuffers.token2022 : staticBuffers.seed,
        mint.toBuffer(),
      ],
      staticAccounts.associatedProgramId
    );

    const [creatorVault] = PublicKey.findProgramAddressSync(
      [staticBuffers.creatorVault, bondingCurveCreator.toBuffer()],
      this.program.programId
    );

    const keys = [
      {
        pubkey: staticAccounts.global,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: isMayhemMode ? staticAccounts.mayhemFeeRecipient : feeRecipient,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: mint,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: bondingCurve,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: associatedBondingCurve,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: associatedUser,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: seller,
        isSigner: true,
        isWritable: true,
      },
      {
        pubkey: staticAccounts.systemProgram,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: creatorVault,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: isMayhemMode
          ? staticAccounts.token2022Program
          : staticAccounts.tokenProgram,
        isSigner: false,
        isWritable: false,
      },

      {
        pubkey: staticAccounts.eventAuthority,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: staticAccounts.programId,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: staticAccounts.feeConfig,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: staticAccounts.feeProgram,
        isSigner: false,
        isWritable: false,
      },
    ];

    const sellIns = new TransactionInstruction({
      programId: this.program.programId,
      keys,
      data,
    });

    return [sellIns];
  }

  async getBondingCurveAccount(
    mint: PublicKey,
    commitment: Commitment = DEFAULT_COMMITMENT
  ) {
    const tokenAccount = await this.connection.getAccountInfo(
      this.getBondingCurvePDA(mint),
      commitment
    );
    if (!tokenAccount) {
      return null;
    }
    return BondingCurveAccount.fromBuffer(tokenAccount!.data);
  }

  async getGlobalAccount(commitment: Commitment = DEFAULT_COMMITMENT) {
    const [globalAccountPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from(GLOBAL_ACCOUNT_SEED)],
      new PublicKey(PROGRAM_ID)
    );

    const tokenAccount = await this.connection.getAccountInfo(
      globalAccountPDA,
      commitment
    );

    return GlobalAccount.fromBuffer(tokenAccount!.data);
  }

  getBondingCurvePDA(mint: PublicKey) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from(BONDING_CURVE_SEED), mint.toBuffer()],
      this.program.programId
    )[0];
  }

  async createTokenMetadata(create: CreateTokenMetadata) {
    // Validate file
    if (!(create.file instanceof Blob)) {
      throw new Error("File must be a Blob or File object");
    }

    let formData = new FormData();
    formData.append("file", create.file, "image.png"); // Add filename
    formData.append("name", create.name);
    formData.append("symbol", create.symbol);
    formData.append("description", create.description);
    formData.append("twitter", create.twitter || "");
    formData.append("telegram", create.telegram || "");
    formData.append("website", create.website || "");
    formData.append("showName", "true");

    try {
      const request = await fetch("https://pump.fun/api/ipfs", {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: formData,
        credentials: "same-origin",
      });

      if (request.status === 500) {
        // Try to get more error details
        const errorText = await request.text();
        throw new Error(
          `Server error (500): ${errorText || "No error details available"}`
        );
      }

      if (!request.ok) {
        throw new Error(`HTTP error! status: ${request.status}`);
      }

      const responseText = await request.text();
      if (!responseText) {
        throw new Error("Empty response received from server");
      }

      try {
        return JSON.parse(responseText);
      } catch (e) {
        throw new Error(`Invalid JSON response: ${responseText}`);
      }
    } catch (error) {
      console.error("Error in createTokenMetadata:", error);
      throw error;
    }
  }
  //EVENTS
  addEventListener<T extends PumpFunEventType>(
    eventType: T,
    callback: (
      event: PumpFunEventHandlers[T],
      slot: number,
      signature: string
    ) => void
  ) {
    return this.program.addEventListener(
      eventType,
      (event: any, slot: number, signature: string) => {
        let processedEvent;
        switch (eventType) {
          case "createEvent":
            processedEvent = toCreateEvent(event as CreateEvent);
            callback(
              processedEvent as PumpFunEventHandlers[T],
              slot,
              signature
            );
            break;
          case "tradeEvent":
            processedEvent = toTradeEvent(event as TradeEvent);
            callback(
              processedEvent as PumpFunEventHandlers[T],
              slot,
              signature
            );
            break;
          case "completeEvent":
            processedEvent = toCompleteEvent(event as CompleteEvent);
            callback(
              processedEvent as PumpFunEventHandlers[T],
              slot,
              signature
            );
            console.log("completeEvent", event, slot, signature);
            break;
          case "setParamsEvent":
            processedEvent = toSetParamsEvent(event as SetParamsEvent);
            callback(
              processedEvent as PumpFunEventHandlers[T],
              slot,
              signature
            );
            break;
          default:
            console.error("Unhandled event type:", eventType);
        }
      }
    );
  }

  removeEventListener(eventId: number) {
    this.program.removeEventListener(eventId);
  }
}
