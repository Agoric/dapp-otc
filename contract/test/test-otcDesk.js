// @ts-nocheck

/* global harden */

import '@agoric/install-ses';
import test from 'ava';
// xxeslint-disable-next-line import/no-extraneous-dependencies
import bundleSource from '@agoric/bundle-source';

import { E } from '@agoric/eventual-send';
import { makeFakeVatAdmin } from '@agoric/zoe/test/unitTests/contracts/fakeVatAdmin';
import { makeZoe } from '@agoric/zoe';
import { makeIssuerKit, MathKind } from '@agoric/ertp';
import buildManualTimer from '@agoric/zoe/tools/manualTimer';

const coveredCallPath = `${__dirname}/../src/coveredCall`;
const otcDeskPath = `${__dirname}/../src/otcDesk`;

test('contract with valid offers', async t => {
  // Outside of tests, we should use the long-lived Zoe on the
  // testnet. In this test, we must create a new Zoe.
  const zoe = makeZoe(makeFakeVatAdmin());

  // Alice wants to be able to add inventory, remove inventory, and
  // make quotes for bob. The quotes will be in the form of a free
  // option given to Bob.

  const coveredCallBundle = await bundleSource(coveredCallPath);
  const coveredCallInstallation = await E(zoe).install(coveredCallBundle);
  t.is(await E(coveredCallInstallation).getBundle(), coveredCallBundle);

  const otcDeskBundle = await bundleSource(otcDeskPath);
  const otcDeskInstallation = await E(zoe).install(otcDeskBundle);
  t.is(await E(otcDeskInstallation).getBundle(), otcDeskBundle);

  // Create a magical item NFT mint
  const magicItemKit = makeIssuerKit('magicItem', MathKind.STRING_SET);
  // value is i.e. ['sword1', 'magicWand8281']

  // Create fungible tokens
  const moolaKit = makeIssuerKit('moola');
  // value is i.e. 20, or 44

  const magicWandAmount = magicItemKit.amountMath.make(
    harden(['magicWand8281']),
  );

  const magicItemsAmount = magicItemKit.amountMath.make(
    harden(['magicWand8281', 'sword1', 'sword2']),
  );

  const moola1000 = moolaKit.amountMath.make(1000);

  const moola20 = moolaKit.amountMath.make(20);

  const aliceMagicWandPayment = magicItemKit.mint.mintPayment(magicWandAmount);
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
  const deadline = 2;

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
  t.deepEqual(details.deadline, 2);

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

  t.is(await E(bobSeat).getOfferResult(), 'Offer was exercised');

  const bobMagicItemPayout = await E(bobSeat).getPayout('UnderlyingAsset');
  const bobMoolaPayout = await E(bobSeat).getPayout('StrikePrice');

  t.deepEqual(
    await magicItemKit.issuer.getAmountOf(bobMagicItemPayout),
    magicWandAmount,
  );

  t.deepEqual(
    await moolaKit.issuer.getAmountOf(bobMoolaPayout),
    moolaKit.amountMath.getEmpty(),
  );

  const removeInventoryInvitation = await E(
    creatorFacet,
  ).makeRemoveInventoryInvitation();

  const moola2 = moolaKit.amountMath.make(2);

  const removeInventoryProposal = harden({
    want: { Moola: moola2 },
  });

  const removeInventorySeat = await E(zoe).offer(
    removeInventoryInvitation,
    removeInventoryProposal,
  );

  t.is(await E(removeInventorySeat).getOfferResult(), 'Inventory removed');
});
