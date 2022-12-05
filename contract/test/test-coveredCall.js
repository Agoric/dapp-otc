// @ts-check

import '@agoric/zoe/tools/prepare-test-env.js';
import test from 'ava';
import bundleSource from '@endo/bundle-source';

import url from 'url';
import { resolve as importMetaResolve } from 'import-meta-resolve';

import { E } from '@endo/far';
import { makeFakeVatAdmin } from '@agoric/zoe/tools/fakeVatAdmin.js';
import { makeZoeKit } from '@agoric/zoe';
import { makeIssuerKit, AssetKind, AmountMath } from '@agoric/ertp';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';

test('contract with valid offers', async t => {
  // Outside of tests, we should use the long-lived Zoe on the
  // testnet. In this test, we must create a new Zoe.
  const { zoeService } = makeZoeKit(makeFakeVatAdmin().admin);
  const feePurse = E(E(zoeService).getFeeIssuer()).makeEmptyPurse();
  const zoe = E(zoeService).bindDefaultFeePurse(feePurse);

  // Alice is going to want to trade a magical wand item for some fake
  // currency, moola

  // Alice is going to give a contract invitation to Bob, who will
  // provide the moola and buy the magical wand item

  // Covered call option is the right but not the obligation to buy
  // the magical wand.

  const coveredCallUrl = await importMetaResolve(
    '@agoric/zoe/src/contracts/coveredCall.js',
    import.meta.url,
  );
  const coveredCallPath = url.fileURLToPath(coveredCallUrl);
  const coveredCallBundle = await bundleSource(coveredCallPath);

  const coveredCallInstallation = await E(zoe).install(coveredCallBundle);

  t.deepEqual(await E(coveredCallInstallation).getBundle(), coveredCallBundle);

  // Create a magical item NFT mint
  const magicItemKit = makeIssuerKit('magicItem', AssetKind.SET);
  // value is i.e. ['sword1', 'magicWand8281']

  // Create fungible tokens
  const moolaKit = makeIssuerKit('moola');
  // value is i.e. 20, or 44

  const magicWandAmount = AmountMath.make(
    magicItemKit.brand,
    harden(['magicWand8281']),
  );
  const moola20 = AmountMath.make(moolaKit.brand, 20n);
  const aliceMagicWandPayment = magicItemKit.mint.mintPayment(magicWandAmount);
  const bobMoolaPayment = moolaKit.mint.mintPayment(moola20);

  t.deepEqual(
    await magicItemKit.issuer.getAmountOf(aliceMagicWandPayment),
    magicWandAmount,
  );

  const issuerKeywordRecord = harden({
    UnderlyingAsset: magicItemKit.issuer,
    StrikePrice: moolaKit.issuer,
  });

  const { creatorInvitation } = await E(zoe).startInstance(
    coveredCallInstallation,
    issuerKeywordRecord,
  );

  const invitationIssuer = await E(zoe).getInvitationIssuer();
  t.truthy(await E(invitationIssuer).isLive(creatorInvitation));

  const timer = buildManualTimer(console.log);

  const aliceProposal = harden({
    give: { UnderlyingAsset: magicWandAmount },
    want: { StrikePrice: moola20 },
    exit: {
      afterDeadline: {
        timer,
        deadline: 2n,
      },
    },
  });

  const alicePayments = harden({
    UnderlyingAsset: aliceMagicWandPayment,
  });

  // Alice escrows the magic wand using her invitation
  const aliceSeat = await E(zoe).offer(
    creatorInvitation,
    aliceProposal,
    alicePayments,
  );

  // Invitation for Bob, an option
  const bobInvitation = await E(aliceSeat).getOfferResult();
  t.truthy(await E(invitationIssuer).isLive(bobInvitation));

  // Bob receives the invitation from Alice
  // He doesn't trust alice, so he wants inspect the invitation
  // claimedInvitation === option
  const claimedInvitation = await E(invitationIssuer).claim(bobInvitation);
  const details = await E(zoe).getInvitationDetails(claimedInvitation);
  // Bob checks that the code of the contract he is invited to is what
  // he expects
  t.is(details.installation, coveredCallInstallation);
  t.deepEqual(details.underlyingAssets, { UnderlyingAsset: magicWandAmount });
  t.deepEqual(details.strikePrice, { StrikePrice: moola20 });
  t.deepEqual(details.timeAuthority, timer);
  t.deepEqual(details.expirationDate, 2n);

  // E(invitationIssuer).getAmountOf(claimInvitation);

  const bobProposal = harden({
    give: { StrikePrice: moola20 },
    want: { UnderlyingAsset: magicWandAmount },
    exit: { onDemand: null },
  });

  const bobPayments = harden({
    StrikePrice: bobMoolaPayment,
  });

  const bobSeat = await E(zoe).offer(
    claimedInvitation,
    bobProposal,
    bobPayments,
  );

  t.is(
    await E(bobSeat).getOfferResult(),
    'The option was exercised. Please collect the assets in your payout.',
  );

  const bobMagicItemPayout = await E(bobSeat).getPayout('UnderlyingAsset');
  const bobMoolaPayout = await E(bobSeat).getPayout('StrikePrice');

  t.deepEqual(
    await magicItemKit.issuer.getAmountOf(bobMagicItemPayout),
    magicWandAmount,
  );

  t.deepEqual(
    await moolaKit.issuer.getAmountOf(bobMoolaPayout),
    AmountMath.makeEmpty(moolaKit.brand, AssetKind.NAT),
  );

  // Alice gets what she wanted

  const aliceMagicItemPayout = await E(aliceSeat).getPayout('UnderlyingAsset');
  const aliceMoolaPayout = await E(aliceSeat).getPayout('StrikePrice');

  t.deepEqual(
    await magicItemKit.issuer.getAmountOf(aliceMagicItemPayout),
    AmountMath.makeEmpty(magicItemKit.brand, AssetKind.SET),
  );

  t.deepEqual(await moolaKit.issuer.getAmountOf(aliceMoolaPayout), moola20);
});
