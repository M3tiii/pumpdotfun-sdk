import { Commitment, Connection, Finality, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { Program, Provider } from "@coral-xyz/anchor";
import { GlobalAccount } from "./globalAccount";
import { CreateTokenMetadata, PriorityFee, PumpFunEventHandlers, PumpFunEventType, TransactionResult } from "./types";
import { BondingCurveAccount } from "./bondingCurveAccount";
import { PumpFun } from "./IDL";
export declare const GLOBAL_ACCOUNT_SEED = "global";
export declare const MINT_AUTHORITY_SEED = "mint-authority";
export declare const BONDING_CURVE_SEED = "bonding-curve";
export declare const METADATA_SEED = "metadata";
export declare const DEFAULT_DECIMALS = 6;
export declare class PumpFunSDK {
    program: Program<PumpFun>;
    connection: Connection;
    constructor(provider?: Provider);
    prepareTokenCreation(creator: Keypair, mint: Keypair, buyAmountSol: bigint, sellAmountSol: bigint, slippageBasisPoints?: bigint, commitment?: Commitment, finality?: Finality): Promise<{
        create: (createTokenMetadata: CreateTokenMetadata, priorityFees: PriorityFee) => Promise<TransactionResult>;
        sell: (priorityFees: PriorityFee) => Promise<TransactionResult>;
    }>;
    createAndBuy(creator: Keypair, mint: Keypair, createTokenMetadata: CreateTokenMetadata, buyAmountSol: bigint, slippageBasisPoints?: bigint, priorityFees?: PriorityFee, commitment?: Commitment, finality?: Finality): Promise<TransactionResult>;
    buy(buyer: Keypair, mint: PublicKey, buyAmountSol: bigint, slippageBasisPoints?: bigint, priorityFees?: PriorityFee, commitment?: Commitment, finality?: Finality): Promise<TransactionResult>;
    sell(seller: Keypair, mint: PublicKey, sellTokenAmount: bigint, slippageBasisPoints?: bigint, priorityFees?: PriorityFee, commitment?: Commitment, finality?: Finality): Promise<TransactionResult>;
    getCreateInstructions(creator: PublicKey, name: string, symbol: string, uri: string, mint: Keypair): Promise<Transaction>;
    getBuyInstructionsBySolAmount(buyer: PublicKey, mint: PublicKey, buyAmountSol: bigint, slippageBasisPoints?: bigint, commitment?: Commitment): Promise<Transaction>;
    getBuyInstructions(buyer: PublicKey, mint: PublicKey, feeRecipient: PublicKey, amount: bigint, solAmount: bigint, commitment?: Commitment): Promise<Transaction>;
    getSellInstructionsByTokenAmount(seller: PublicKey, mint: PublicKey, sellTokenAmount: bigint, slippageBasisPoints?: bigint, commitment?: Commitment): Promise<Transaction>;
    getSellInstructions(seller: PublicKey, mint: PublicKey, feeRecipient: PublicKey, amount: bigint, minSolOutput: bigint): Promise<Transaction>;
    getBondingCurveAccount(mint: PublicKey, commitment?: Commitment): Promise<BondingCurveAccount | null>;
    getGlobalAccount(commitment?: Commitment): Promise<GlobalAccount>;
    getBondingCurvePDA(mint: PublicKey): PublicKey;
    createTokenMetadata(create: CreateTokenMetadata): Promise<any>;
    addEventListener<T extends PumpFunEventType>(eventType: T, callback: (event: PumpFunEventHandlers[T], slot: number, signature: string) => void): number;
    removeEventListener(eventId: number): void;
}
//# sourceMappingURL=pumpfun.d.ts.map