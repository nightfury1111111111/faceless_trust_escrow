import * as anchor from "@project-serum/anchor";
import NodeWallet from "@project-serum/anchor/dist/cjs/nodewallet";
import { IDL } from "../target/types/anchor_escrow";
import { PublicKey, SystemProgram, Transaction, Connection, Commitment } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount } from "@solana/spl-token";
import { assert } from "chai";

describe("anchor-escrow", () => {
  // Use Mainnet-fork for testing
  const commitment: Commitment = "confirmed";
  const connection = new Connection("https://rpc-mainnet-fork.epochs.studio", {
    commitment,
    wsEndpoint: "wss://rpc-mainnet-fork.epochs.studio/ws",
  });
  const options = anchor.AnchorProvider.defaultOptions();
  const wallet = NodeWallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, options);

  anchor.setProvider(provider);

  // CAUTTION: if you are intended to use the program that is deployed by yourself,
  // please make sure that the programIDs are consistent
  const programId = new PublicKey("GW65RiuuG2zU27S39FW83Yug1t13RxWWwHSCWRwSaybC");
  const program = new anchor.Program(IDL, programId, provider);

  let mintA = null as PublicKey;
  let mintB = null as PublicKey;
  let initializerTokenAccountA = null as PublicKey;
  let initializerTokenAccountB = null as PublicKey;
  let takerTokenAccountA = null as PublicKey;
  let takerTokenAccountB = null as PublicKey;

  const takerAmount = 1000;
  const initializerAmount = 500;

  // Main Roles
  const payer = anchor.web3.Keypair.generate();
  const mintAuthority = anchor.web3.Keypair.generate();
  const initializer = anchor.web3.Keypair.generate();
  const taker = anchor.web3.Keypair.generate();

  // Determined Seeds
  const stateSeed = "state";
  const vaultSeed = "vault";
  const authoritySeed = "authority";

  // Random Seed
  const randomSeed: anchor.BN = new anchor.BN(Math.floor(Math.random() * 100000000));

  // Derive PDAs: escrowStateKey, vaultKey, vaultAuthorityKey
  const escrowStateKey = PublicKey.findProgramAddressSync(
    [Buffer.from(anchor.utils.bytes.utf8.encode(stateSeed)), randomSeed.toArrayLike(Buffer, "le", 8)],
    program.programId
  )[0];

  const vaultKey = PublicKey.findProgramAddressSync(
    [Buffer.from(anchor.utils.bytes.utf8.encode(vaultSeed)), randomSeed.toArrayLike(Buffer, "le", 8)],
    program.programId
  )[0];

  const vaultAuthorityKey = PublicKey.findProgramAddressSync(
    [Buffer.from(anchor.utils.bytes.utf8.encode(authoritySeed))],
    program.programId
  )[0];

  it("Initialize program state", async () => {
    // 1. Airdrop 1 SOL to payer
    const signature = await provider.connection.requestAirdrop(payer.publicKey, 1000000000);
    const latestBlockhash = await connection.getLatestBlockhash();
    await provider.connection.confirmTransaction(
      {
        signature,
        ...latestBlockhash,
      },
      commitment
    );

    // 2. Fund main roles: initializer and taker
    const fundingTx = new Transaction();
    fundingTx.add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: initializer.publicKey,
        lamports: 100000000,
      }),
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: taker.publicKey,
        lamports: 100000000,
      })
    );

    await provider.sendAndConfirm(fundingTx, [payer]);

    // 3. Create dummy token mints: mintA and mintB
    mintA = await createMint(connection, payer, mintAuthority.publicKey, null, 0);
    mintB = await createMint(provider.connection, payer, mintAuthority.publicKey, null, 0);

    // 4. Create token accounts for dummy token mints and both main roles
    initializerTokenAccountA = await createAccount(connection, initializer, mintA, initializer.publicKey);
    initializerTokenAccountB = await createAccount(connection, initializer, mintB, initializer.publicKey);
    takerTokenAccountA = await createAccount(connection, taker, mintA, taker.publicKey);
    takerTokenAccountB = await createAccount(connection, taker, mintB, taker.publicKey);

    // 5. Mint dummy tokens to initializerTokenAccountA and takerTokenAccountB
    await mintTo(connection, initializer, mintA, initializerTokenAccountA, mintAuthority, initializerAmount);
    await mintTo(connection, taker, mintB, takerTokenAccountB, mintAuthority, takerAmount);

    const fetchedInitializerTokenAccountA = await getAccount(connection, initializerTokenAccountA);
    const fetchedTakerTokenAccountB = await getAccount(connection, takerTokenAccountB);

    assert.ok(Number(fetchedInitializerTokenAccountA.amount) == initializerAmount);
    assert.ok(Number(fetchedTakerTokenAccountB.amount) == takerAmount);
  });

  it("Initialize escrow", async () => {
    await program.methods
      .initialize(randomSeed, new anchor.BN(initializerAmount), new anchor.BN(takerAmount))
      .accounts({
        initializer: initializer.publicKey,
        vault: vaultKey,
        mint: mintA,
        initializerDepositTokenAccount: initializerTokenAccountA,
        initializerReceiveTokenAccount: initializerTokenAccountB,
        escrowState: escrowStateKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([initializer])
      .rpc();

    let fetchedVault = await getAccount(connection, vaultKey);
    let fetchedEscrowState = await program.account.escrowState.fetch(escrowStateKey);

    // Check that the new owner is the PDA.
    assert.ok(fetchedVault.owner.equals(vaultAuthorityKey));

    // Check that the values in the escrow account match what we expect.
    assert.ok(fetchedEscrowState.initializerKey.equals(initializer.publicKey));
    assert.ok(fetchedEscrowState.initializerAmount.toNumber() == initializerAmount);
    assert.ok(fetchedEscrowState.takerAmount.toNumber() == takerAmount);
    assert.ok(fetchedEscrowState.initializerDepositTokenAccount.equals(initializerTokenAccountA));
    assert.ok(fetchedEscrowState.initializerReceiveTokenAccount.equals(initializerTokenAccountB));
  });

  it("Exchange escrow state", async () => {
    await program.methods
      .exchange()
      .accounts({
        taker: taker.publicKey,
        takerDepositTokenAccount: takerTokenAccountB,
        takerReceiveTokenAccount: takerTokenAccountA,
        initializerDepositTokenAccount: initializerTokenAccountA,
        initializerReceiveTokenAccount: initializerTokenAccountB,
        initializer: initializer.publicKey,
        escrowState: escrowStateKey,
        vault: vaultKey,
        vaultAuthority: vaultAuthorityKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([taker])
      .rpc();

    let fetchedInitializerTokenAccountA = await getAccount(connection, initializerTokenAccountA);
    let fetchedInitializerTokenAccountB = await getAccount(connection, initializerTokenAccountB);
    let fetchedTakerTokenAccountA = await getAccount(connection, takerTokenAccountA);
    let fetchedTakerTokenAccountB = await getAccount(connection, takerTokenAccountB);

    assert.ok(Number(fetchedTakerTokenAccountA.amount) == initializerAmount);
    assert.ok(Number(fetchedInitializerTokenAccountA.amount) == 0);
    assert.ok(Number(fetchedInitializerTokenAccountB.amount) == takerAmount);
    assert.ok(Number(fetchedTakerTokenAccountB.amount) == 0);
  });

  it("Initialize escrow and cancel escrow", async () => {
    // Put back tokens into initializer token A account.

    await mintTo(connection, initializer, mintA, initializerTokenAccountA, mintAuthority, initializerAmount);

    await program.methods
      .initialize(randomSeed, new anchor.BN(initializerAmount), new anchor.BN(takerAmount))
      .accounts({
        initializer: initializer.publicKey,
        vault: vaultKey,
        mint: mintA,
        initializerDepositTokenAccount: initializerTokenAccountA,
        initializerReceiveTokenAccount: initializerTokenAccountB,
        escrowState: escrowStateKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([initializer])
      .rpc();

    // Cancel the escrow.
    await program.methods
      .cancel()
      .accounts({
        initializer: initializer.publicKey,
        initializerDepositTokenAccount: initializerTokenAccountA,
        vault: vaultKey,
        vaultAuthority: vaultAuthorityKey,
        escrowState: escrowStateKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([initializer])
      .rpc();

    // Check the final owner should be the provider public key.
    const fetchedInitializerTokenAccountA = await getAccount(connection, initializerTokenAccountA);

    assert.ok(fetchedInitializerTokenAccountA.owner.equals(initializer.publicKey));
    // Check all the funds are still there.
    assert.ok(Number(fetchedInitializerTokenAccountA.amount) == initializerAmount);
  });
});
