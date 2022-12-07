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
  const otcDeskUrl = await importMetaResolve(
    '../src/otcDesk.js',
    import.meta.url,
  );
  const otcDeskPath = url.fileURLToPath(otcDeskUrl);

  // Outside of tests, we should use the long-lived Zoe on the
  // testnet. In this test, we must create a new Zoe.
  const { zoeService: zoe } = makeZoeKit(makeFakeVatAdmin().admin);

  // Alice wants to be able to add inventory, remove inventory, and
  // make quotes for bob. The quotes will be in the form of a free
  // option given to Bob.

  const coveredCallUrl = await importMetaResolve(
    '@agoric/zoe/src/contracts/coveredCall.js',
    import.meta.url,
  );
  const coveredCallPath = url.fileURLToPath(coveredCallUrl);
  const coveredCallBundle = await bundleSource(coveredCallPath);
  const coveredCallInstallation = await E(zoe).install(coveredCallBundle);
  t.deepEqual(await E(coveredCallInstallation).getBundle(), coveredCallBundle);

  const otcDeskBundle = await bundleSource(otcDeskPath);
  const otcDeskInstallation = await E(zoe).install(otcDeskBundle);
  t.deepEqual(await E(otcDeskInstallation).getBundle(), otcDeskBundle);

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

  const magicItemsAmount = AmountMath.make(
    magicItemKit.brand,
    harden(['magicWand8281', 'sword1', 'sword2']),
  );

  const moola1000 = AmountMath.make(moolaKit.brand, 1000n);

  const moola20 = AmountMath.make(moolaKit.brand, 20n);

  const bobMoolaPayment = moolaKit.mint.mintPayment(moola20);

  // Alice's inventory
  const aliceMagicItemsPayment = magicItemKit.mint.mintPayment(
    magicItemsAmount,
  );
  const aliceMoola1000Payment = moolaKit.mint.mintPayment(moola1000);

  const { creatorFacet } = await E(zoe).startInstance(
    otcDeskInstallation,
    undefined,
    { coveredCallInstallation },
  );

  const issuerKeywordRecord = {
    Magic: magicItemKit.issuer,
    Moola: moolaKit.issuer,
  };

  const addInventoryInvitation = await E(
    creatorFacet,
  ).makeAddInventoryInvitation(issuerKeywordRecord);

  const invitationIssuer = await E(zoe).getInvitationIssuer();
  t.truthy(await E(invitationIssuer).isLive(addInventoryInvitation));

  // Alice wants to add inventory

  const addInventoryProposal = harden({
    give: { Magic: magicItemsAmount, Moola: moola1000 },
  });

  const addInventoryPayments = harden({
    Magic: aliceMagicItemsPayment,
    Moola: aliceMoola1000Payment,
  });

  const aliceAddInventorySeat = await E(zoe).offer(
    addInventoryInvitation,
    addInventoryProposal,
    addInventoryPayments,
  );

  t.is(await E(aliceAddInventorySeat).getOfferResult(), 'Inventory added');

  // Alice is going to make a quote for Bob. She's going to trade a
  // magic wand for 20 moola.

  const timer = buildManualTimer(console.log);

  const assets = { Magic: magicWandAmount };
  const price = { Moola: moola20 };
  const timeAuthority = timer;
  const deadline = 2n;

  const bobInvitation = await E(creatorFacet).makeQuote(
    assets,
    price,
    timeAuthority,
    deadline,
  );

  // Invitation for Bob, an option
  t.truthy(await E(invitationIssuer).isLive(bobInvitation));

  // Bob receives the invitation from Alice
  // He doesn't trust alice, so he wants inspect the invitation
  // claimedInvitation === option
  const claimedInvitation = await E(invitationIssuer).claim(bobInvitation);
  const details = await E(zoe).getInvitationDetails(claimedInvitation);
  // Bob checks that the code of the contract he is invited to is what
  // he expects
  t.is(details.installation, coveredCallInstallation);
  t.deepEqual(details.underlyingAssets, { Magic: magicWandAmount });
  t.deepEqual(details.strikePrice, { Moola: moola20 });
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

  const removeInventoryInvitation = await E(
    creatorFacet,
  ).makeRemoveInventoryInvitation();

  const moola2 = AmountMath.make(moolaKit.brand, 2n);

  const removeInventoryProposal = harden({
    want: { Moola: moola2 },
  });

  const removeInventorySeat = await E(zoe).offer(
    removeInventoryInvitation,
    removeInventoryProposal,
  );

  t.is(await E(removeInventorySeat).getOfferResult(), 'Inventory removed');
});
