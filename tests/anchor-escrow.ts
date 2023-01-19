import * as anchor from "@project-serum/anchor";
import NodeWallet from "@project-serum/anchor/dist/cjs/nodewallet";
import { IDL } from "../target/types/anchor_escrow";
import { PublicKey, SystemProgram, Transaction, Connection, Commitment } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount, transfer } from "@solana/spl-token";
import { assert } from "chai";

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

describe("anchor-escrow", () => {
  // Use Mainnet-fork for testing
  const commitment: Commitment = "confirmed";
  const connection = new Connection("https://api.devnet.solana.com", {
    commitment,
    // wsEndpoint: "wss://api.devnet.solana.com/",
  });
  const options = anchor.AnchorProvider.defaultOptions();
  const wallet = NodeWallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, options);

  anchor.setProvider(provider);

  // CAUTTION: if you are intended to use the program that is deployed by yourself,
  // please make sure that the programIDs are consistent
  const programId = new PublicKey("APuaECoAAhGXEK8UPKUF7csup1n2TTtFhxZeN1V6ChY7");
  const program = new anchor.Program(IDL, programId, provider);

  let mintA = null as PublicKey;
  let initializerTokenAccountA = null as PublicKey;
  let takerTokenAccountA = null as PublicKey;
  let admin1AccountA = null as PublicKey;
  let admin2AccountA = null as PublicKey;
  let resolverAccountA = null as PublicKey;
  let localWalletAccountA = null as PublicKey;

  const initializerAmount = 500;

  // Main Roles
  const payer = anchor.web3.Keypair.generate();
  const mintAuthority = anchor.web3.Keypair.generate();
  const initializer = anchor.web3.Keypair.generate();
  const taker = anchor.web3.Keypair.generate();
  const admin1 = anchor.web3.Keypair.generate();
  const admin2 = anchor.web3.Keypair.generate();
  const resolver = anchor.web3.Keypair.generate();

  // Determined Seeds
  const adminSeed = "admin";
  const stateSeed = "state";
  const vaultSeed = "vault";
  const authoritySeed = "authority";

  // Random Seed
  const randomSeed: anchor.BN = new anchor.BN(Math.floor(Math.random() * 100000000));

  const adminKey = PublicKey.findProgramAddressSync(
    [Buffer.from(anchor.utils.bytes.utf8.encode(stateSeed)), Buffer.from(anchor.utils.bytes.utf8.encode(adminSeed))],
    program.programId
  )[0];

  // Derive PDAs: escrowStateKey, vaultKey, vaultAuthorityKey
  const escrowStateKey = PublicKey.findProgramAddressSync(
    [Buffer.from(anchor.utils.bytes.utf8.encode(stateSeed)), randomSeed.toArrayLike(Buffer, "le", 8)],
    program.programId
  )[0];

  const vaultKey = PublicKey.findProgramAddressSync(
    [Buffer.from(anchor.utils.bytes.utf8.encode(vaultSeed)), randomSeed.toArrayLike(Buffer, "le", 8)],
    program.programId
  )[0];

  // Random Seed
  const randomSeed2: anchor.BN = new anchor.BN(Math.floor(Math.random() * 100000000));

  // Derive PDAs: escrowStateKey, vaultKey, vaultAuthorityKey
  const escrowStateKey2 = PublicKey.findProgramAddressSync(
    [Buffer.from(anchor.utils.bytes.utf8.encode(stateSeed)), randomSeed2.toArrayLike(Buffer, "le", 8)],
    program.programId
  )[0];

  const vaultKey2 = PublicKey.findProgramAddressSync(
    [Buffer.from(anchor.utils.bytes.utf8.encode(vaultSeed)), randomSeed2.toArrayLike(Buffer, "le", 8)],
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
      }),
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: admin1.publicKey,
        lamports: 100000000,
      }),
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: admin2.publicKey,
        lamports: 100000000,
      })
    );

    await provider.sendAndConfirm(fundingTx, [payer]);
    // 3. Create dummy token mints: mintA and mintB
    mintA = new PublicKey("Ad4JSN6xUeok3JVgow9LTJ8GW1K1y8W397nsZrNYYW5E");

    // 4. Create token accounts for dummy token mints and both main roles
    initializerTokenAccountA = await createAccount(connection, wallet.payer, mintA, initializer.publicKey);
    takerTokenAccountA = await createAccount(connection, wallet.payer, mintA, taker.publicKey);
    localWalletAccountA = new PublicKey("DkE9WW8Fd19muMq6j4Jaehv3Kn75YfbmrFZtwKCZ8mwC");
    admin1AccountA = await createAccount(connection, wallet.payer, mintA, admin1.publicKey);
    admin2AccountA = await createAccount(connection, wallet.payer, mintA, admin2.publicKey);
    resolverAccountA = await createAccount(connection, wallet.payer, mintA, resolver.publicKey);

    // 5. Mint dummy tokens to initializerTokenAccountA and takerTokenAccountB
    await transfer(
      connection,
      wallet.payer,
      localWalletAccountA,
      initializerTokenAccountA,
      wallet.publicKey,
      initializerAmount
    );

    await wait(1000);

    const fetchedInitializerTokenAccountA = await getAccount(connection, initializerTokenAccountA);

    assert.ok(Number(fetchedInitializerTokenAccountA.amount) == initializerAmount);

    console.log({
      localWallet: wallet.publicKey.toString(),
      localWalletAccountA: localWalletAccountA.toString(),
      admin1: admin1.publicKey.toString(),
      admin2: admin2.publicKey.toString(),
      initializer: initializer.publicKey.toString(),
      taker: taker.publicKey.toString(),
      mintA: mintA.toString(),
      vault: vaultKey.toString(),
      vaultAuthorityKey: vaultAuthorityKey.toString(),
      takerTokenAccountA: takerTokenAccountA.toString(),
      adminKey: adminKey.toString(),
    });
  });

  it("init admin address", async () => {
    await program.methods
      .initAdmin()
      .accounts({
        admin1: wallet.publicKey.toString(),
        admin1TokenAccount: localWalletAccountA.toString(),
        admin2: admin2.publicKey.toString(),
        admin2TokenAccount: admin2AccountA.toString(),
        adminState: adminKey.toString(),
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([wallet.payer])
      .rpc();

    await wait(500);
    const fetchedAdminState: any = await program.account.adminState.fetch(adminKey);
    assert.ok(fetchedAdminState.admin1.toString() === wallet.publicKey.toString());
    assert.ok(fetchedAdminState.admin2.toString() === admin2.publicKey.toString());
  });

  it("change admin address", async () => {
    await program.methods
      .changeAdmin()
      .accounts({
        admin1: wallet.publicKey.toString(),
        newAdmin1: wallet.publicKey.toString(),
        newAdmin2: admin2.publicKey.toString(),
        newAdmin1TokenAccount: localWalletAccountA.toString(),
        newAdmin2TokenAccount: admin2AccountA.toString(),
        adminState: adminKey.toString(),
      })
      .signers([wallet.payer])
      .rpc();

    await wait(1000);
    const fetchedAdminState: any = await program.account.adminState.fetch(adminKey);
    assert.ok(fetchedAdminState.admin1.toString() === wallet.publicKey.toString());
    assert.ok(fetchedAdminState.admin2.toString() === admin2.publicKey.toString());
  });

  it("set fee", async () => {
    const adminfee = 5;
    const resolverfee = 1;
    await program.methods
      .setFee(new anchor.BN(adminfee), new anchor.BN(resolverfee))
      .accounts({
        admin1: wallet.publicKey.toString(),
        adminState: adminKey.toString(),
      })
      .signers([wallet.payer])
      .rpc();

    await wait(500);
    const fetchedAdminState: any = await program.account.adminState.fetch(adminKey);
    assert.ok(fetchedAdminState.adminFee.toNumber() === adminfee);
    assert.ok(fetchedAdminState.resolverFee.toNumber() === resolverfee);
  });

  it("Initialize escrow", async () => {
    await program.methods
      .initialize(randomSeed, [
        new anchor.BN(50),
        new anchor.BN(150),
        new anchor.BN(200),
        new anchor.BN(50),
        new anchor.BN(50),
      ])
      .accounts({
        initializer: initializer.publicKey,
        vault: vaultKey,
        adminState: adminKey,
        resolverTokenAccount: resolverAccountA,
        mint: mintA,
        initializerDepositTokenAccount: initializerTokenAccountA,
        takerTokenAccount: takerTokenAccountA,
        escrowState: escrowStateKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([initializer])
      .rpc();

    await wait(2000);

    let fetchedVault = await getAccount(connection, vaultKey);
    let fetchedEscrowState: any = await program.account.escrowState.fetch(escrowStateKey);
    // Check that the new owner is the PDA.
    assert.ok(fetchedVault.owner.equals(vaultAuthorityKey));

    // Check that the values in the escrow account match what we expect.
    assert.ok(fetchedEscrowState.initializerKey.equals(initializer.publicKey));
    assert.ok(fetchedEscrowState.initializerAmount[0].toNumber() == 50);
    assert.ok(fetchedEscrowState.initializerDepositTokenAccount.equals(initializerTokenAccountA));
  });

  it("Approve escrow state", async () => {
    await program.methods
      .approve(new anchor.BN(0))
      .accounts({
        initializer: initializer.publicKey,
        takerTokenAccount: takerTokenAccountA,
        initializerDepositTokenAccount: initializerTokenAccountA,
        escrowState: escrowStateKey,
        vault: vaultKey,
        vaultAuthority: vaultAuthorityKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([initializer])
      .rpc();

    await wait(1000);
    let fetchedTakerTokenAccountA = await getAccount(connection, takerTokenAccountA);
    assert.ok(Number(fetchedTakerTokenAccountA.amount) == 50);
    let fetchedEscrowState: any = await program.account.escrowState.fetch(escrowStateKey);
    assert.ok(Number(fetchedEscrowState.initializerAmount[0]) == 0);

    await program.methods
      .approve(new anchor.BN(1))
      .accounts({
        initializer: initializer.publicKey,
        takerTokenAccount: takerTokenAccountA,
        initializerDepositTokenAccount: initializerTokenAccountA,
        escrowState: escrowStateKey,
        vault: vaultKey,
        vaultAuthority: vaultAuthorityKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([initializer])
      .rpc();

    await wait(1000);

    fetchedTakerTokenAccountA = await getAccount(connection, takerTokenAccountA);
    assert.ok(Number(fetchedTakerTokenAccountA.amount) == 200);
  });

  it("Withdraw for resolve", async () => {
    // Put back tokens into initializer token A account.
    await transfer(
      connection,
      wallet.payer,
      localWalletAccountA,
      initializerTokenAccountA,
      wallet.publicKey,
      initializerAmount
    );

    await program.methods
      .initialize(randomSeed2, [
        new anchor.BN(50),
        new anchor.BN(150),
        new anchor.BN(200),
        new anchor.BN(50),
        new anchor.BN(50),
      ])
      .accounts({
        initializer: initializer.publicKey,
        vault: vaultKey2,
        adminState: adminKey,
        resolverTokenAccount: resolverAccountA,
        mint: mintA,
        initializerDepositTokenAccount: initializerTokenAccountA,
        takerTokenAccount: takerTokenAccountA,
        escrowState: escrowStateKey2,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([initializer])
      .rpc();

    await wait(1000);

    // Cancel the escrow.
    await program.methods
      .withdrawForResolve()
      .accounts({
        resolver: resolver.publicKey,
        resolverTokenAccount: resolverAccountA,
        vault: vaultKey2,
        vaultAuthority: vaultAuthorityKey,
        escrowState: escrowStateKey2,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([resolver])
      .rpc();

    await wait(1000);

    // Check the final owner should be the provider public key.
    const currentResolverTokenAccount = await getAccount(connection, resolverAccountA);

    assert.ok(currentResolverTokenAccount.owner.equals(resolver.publicKey));
    // Check all the funds are still there.
    assert.ok(Number(currentResolverTokenAccount.amount) == initializerAmount);
  });
});
