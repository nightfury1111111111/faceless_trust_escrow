use anchor_lang::prelude::*;
use anchor_spl::token::{
    self, spl_token::instruction::AuthorityType, CloseAccount, Mint, SetAuthority, Token,
    TokenAccount, Transfer,
};

declare_id!("6DAH49WWWrpGREtQfgVZNTj7nWAFJXqn3ub3gemtKsLf");

#[program]
pub mod anchor_escrow {
    use super::*;

    pub fn init_admin(ctx: Context<InitAdmin>) -> Result<()> {
        ctx.accounts.admin.admin1 = *ctx.accounts.admin1.key;
        ctx.accounts.admin.admin2 = *ctx.accounts.admin2.key;

        Ok(())
    }

    const AUTHORITY_SEED: &[u8] = b"authority";

    pub fn initialize(
        ctx: Context<Initialize>,
        random_seed: u64,
        initializer_amount: [u64; 5],
    ) -> Result<()> {
        ctx.accounts.escrow_state.initializer_key = *ctx.accounts.initializer.key;
        ctx.accounts.escrow_state.initializer_deposit_token_account = *ctx
            .accounts
            .initializer_deposit_token_account
            .to_account_info()
            .key;
        ctx.accounts.escrow_state.initializer_amount = initializer_amount;
        ctx.accounts.escrow_state.random_seed = random_seed;

        let (vault_authority, _vault_authority_bump) =
            Pubkey::find_program_address(&[AUTHORITY_SEED], ctx.program_id);

        token::set_authority(
            ctx.accounts.into_set_authority_context(),
            AuthorityType::AccountOwner,
            Some(vault_authority),
        )?;

        token::transfer(
            ctx.accounts.into_transfer_to_pda_context(),
            ctx.accounts.escrow_state.initializer_amount[0]
                + ctx.accounts.escrow_state.initializer_amount[1]
                + ctx.accounts.escrow_state.initializer_amount[2]
                + ctx.accounts.escrow_state.initializer_amount[3]
                + ctx.accounts.escrow_state.initializer_amount[4],
        )?;

        Ok(())
    }

    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let (_vault_authority, vault_authority_bump) =
            Pubkey::find_program_address(&[AUTHORITY_SEED], ctx.program_id);
        let authority_seeds = &[&AUTHORITY_SEED[..], &[vault_authority_bump]];

        token::transfer(
            ctx.accounts
                .into_transfer_to_initializer_context()
                .with_signer(&[&authority_seeds[..]]),
            ctx.accounts.escrow_state.initializer_amount[0]
                + ctx.accounts.escrow_state.initializer_amount[1]
                + ctx.accounts.escrow_state.initializer_amount[2]
                + ctx.accounts.escrow_state.initializer_amount[3]
                + ctx.accounts.escrow_state.initializer_amount[4],
        )?;

        token::close_account(
            ctx.accounts
                .into_close_context()
                .with_signer(&[&authority_seeds[..]]),
        )?;

        Ok(())
    }

    // pub fn exchange(ctx: Context<Exchange>) -> Result<()> {
    //     let (_vault_authority, vault_authority_bump) =
    //         Pubkey::find_program_address(&[AUTHORITY_SEED], ctx.program_id);
    //     let authority_seeds = &[&AUTHORITY_SEED[..], &[vault_authority_bump]];

    //     token::transfer(
    //         ctx.accounts.into_transfer_to_initializer_context(),
    //         ctx.accounts.escrow_state.taker_amount,
    //     )?;

    //     token::transfer(
    //         ctx.accounts
    //             .into_transfer_to_taker_context()
    //             .with_signer(&[&authority_seeds[..]]),
    //         ctx.accounts.escrow_state.initializer_amount,
    //     )?;

    //     token::close_account(
    //         ctx.accounts
    //             .into_close_context()
    //             .with_signer(&[&authority_seeds[..]]),
    //     )?;

    //     Ok(())
    // }

    pub fn approve(ctx: Context<Approve>, milestone_idx: u64) -> Result<()> {
        let (_vault_authority, vault_authority_bump) =
            Pubkey::find_program_address(&[AUTHORITY_SEED], ctx.program_id);
        let authority_seeds = &[&AUTHORITY_SEED[..], &[vault_authority_bump]];

        token::transfer(
            ctx.accounts
                .into_transfer_to_taker_context()
                .with_signer(&[&authority_seeds[..]]),
            ctx.accounts.escrow_state.initializer_amount[milestone_idx as usize],
        )?;

        ctx.accounts.escrow_state.initializer_amount[milestone_idx as usize] = 0;

        // token::close_account(
        //     ctx.accounts
        //         .into_close_context()
        //         .with_signer(&[&authority_seeds[..]]),
        // )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitAdmin<'info> {
    #[account(mut)]
    pub admin1: Signer<'info>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    pub admin2: AccountInfo<'info>,
    #[account(
        init,
        seeds = [b"admin".as_ref()],
        bump,
        payer = admin1,
        space = Admin::space()
    )]
    pub admin: Box<Account<'info, Admin>>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(escrow_seed: u64, initializer_amount: [u64;5])]
pub struct Initialize<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    pub initializer: Signer<'info>,
    pub mint: Account<'info, Mint>,
    #[account(
        init,
        seeds = [b"vault".as_ref(), &escrow_seed.to_le_bytes()],
        bump,
        payer = initializer,
        token::mint = mint,
        token::authority = initializer,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = initializer_deposit_token_account.amount >=(initializer_amount[0]+initializer_amount[1]+initializer_amount[2]+initializer_amount[3]+initializer_amount[4])
    )]
    pub initializer_deposit_token_account: Account<'info, TokenAccount>,
    #[account(
        init,
        seeds = [b"state".as_ref(), &escrow_seed.to_le_bytes()],
        bump,
        payer = initializer,
        space = EscrowState::space()
    )]
    pub escrow_state: Box<Account<'info, EscrowState>>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    pub initializer: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub vault_authority: AccountInfo<'info>,
    #[account(mut)]
    pub initializer_deposit_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = escrow_state.initializer_key == *initializer.key,
        constraint = escrow_state.initializer_deposit_token_account == *initializer_deposit_token_account.to_account_info().key,
        close = initializer
    )]
    pub escrow_state: Box<Account<'info, EscrowState>>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub token_program: Program<'info, Token>,
}

// #[derive(Accounts)]
// pub struct Exchange<'info> {
//     /// CHECK: This is not dangerous because we don't read or write from this account
//     pub taker: Signer<'info>,
//     #[account(mut)]
//     pub taker_receive_token_account: Box<Account<'info, TokenAccount>>,
//     #[account(mut)]
//     pub initializer_deposit_token_account: Box<Account<'info, TokenAccount>>,
//     /// CHECK: This is not dangerous because we don't read or write from this account
//     #[account(mut)]
//     pub initializer: AccountInfo<'info>,
//     #[account(
//         mut,
//         constraint = escrow_state.initializer_deposit_token_account == *initializer_deposit_token_account.to_account_info().key,
//         constraint = escrow_state.initializer_key == *initializer.key,
//         close = initializer
//     )]
//     pub escrow_state: Box<Account<'info, EscrowState>>,
//     #[account(mut)]
//     pub vault: Box<Account<'info, TokenAccount>>,
//     /// CHECK: This is not dangerous because we don't read or write from this account
//     pub vault_authority: AccountInfo<'info>,
//     /// CHECK: This is not dangerous because we don't read or write from this account
//     pub token_program: Program<'info, Token>,
// }

#[derive(Accounts)]
#[instruction(milestone_idx:u64)]
pub struct Approve<'info> {
    /// CHECK: This is not dangerous because we don't read or write from this account
    #[account(mut)]
    pub initializer: Signer<'info>,
    #[account(mut)]
    pub taker_receive_token_account: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub initializer_deposit_token_account: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = escrow_state.initializer_deposit_token_account == *initializer_deposit_token_account.to_account_info().key,
        constraint = escrow_state.initializer_key == *initializer.key,
        constraint = escrow_state.initializer_amount[milestone_idx as usize] > 0,
    )]
    pub escrow_state: Box<Account<'info, EscrowState>>,
    #[account(mut)]
    pub vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub vault_authority: AccountInfo<'info>,
    /// CHECK: This is not dangerous because we don't read or write from this account
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct EscrowState {
    pub random_seed: u64,
    pub initializer_key: Pubkey,
    pub initializer_deposit_token_account: Pubkey,
    pub initializer_amount: [u64; 5],
}

impl EscrowState {
    pub fn space() -> usize {
        8 + 112
    }
}

#[account]
pub struct Admin {
    pub admin1: Pubkey,
    pub admin2: Pubkey,
}

impl Admin {
    pub fn space() -> usize {
        8 + 64
    }
}

impl<'info> Initialize<'info> {
    fn into_transfer_to_pda_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.initializer_deposit_token_account.to_account_info(),
            to: self.vault.to_account_info(),
            authority: self.initializer.to_account_info(),
        };
        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }

    fn into_set_authority_context(&self) -> CpiContext<'_, '_, '_, 'info, SetAuthority<'info>> {
        let cpi_accounts = SetAuthority {
            account_or_mint: self.vault.to_account_info(),
            current_authority: self.initializer.to_account_info(),
        };
        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }
}

impl<'info> Cancel<'info> {
    fn into_transfer_to_initializer_context(
        &self,
    ) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.vault.to_account_info(),
            to: self.initializer_deposit_token_account.to_account_info(),
            authority: self.vault_authority.clone(),
        };
        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }

    fn into_close_context(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
        let cpi_accounts = CloseAccount {
            account: self.vault.to_account_info(),
            destination: self.initializer.to_account_info(),
            authority: self.vault_authority.clone(),
        };
        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }
}

// impl<'info> Exchange<'info> {
//     fn into_transfer_to_taker_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
//         let cpi_accounts = Transfer {
//             from: self.vault.to_account_info(),
//             to: self.taker_receive_token_account.to_account_info(),
//             authority: self.vault_authority.clone(),
//         };
//         CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
//     }

//     fn into_close_context(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
//         let cpi_accounts = CloseAccount {
//             account: self.vault.to_account_info(),
//             destination: self.initializer.clone(),
//             authority: self.vault_authority.clone(),
//         };
//         CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
//     }
// }

impl<'info> Approve<'info> {
    fn into_transfer_to_taker_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        let cpi_accounts = Transfer {
            from: self.vault.to_account_info(),
            to: self.taker_receive_token_account.to_account_info(),
            authority: self.vault_authority.clone(),
        };
        CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    }

    // fn into_close_context(&self) -> CpiContext<'_, '_, '_, 'info, CloseAccount<'info>> {
    //     let cpi_accounts = CloseAccount {
    //         account: self.vault.to_account_info(),
    //         destination: self.initializer.clone().to_account_info(),
    //         authority: self.vault_authority.clone(),
    //     };
    //     CpiContext::new(self.token_program.to_account_info(), cpi_accounts)
    // }
}
