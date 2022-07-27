// @ts-check
import '@agoric/zoe/exported.js';
import {
  saveAllIssuers,
  assertProposalShape,
  withdrawFromSeat,
  depositToSeat,
} from '@agoric/zoe/src/contractSupport/index.js';
import { E, Far } from '@endo/far';

/**

 * @param {ContractFacet} zcf
 *
 */
const start = async zcf => {
  const { coveredCallInstallation } = zcf.getTerms();
  const { zcfSeat: marketMakerSeat } = zcf.makeEmptySeatKit();
  const zoe = zcf.getZoeService();

  const creatorFacet = Far('creator', {
    makeAddInventoryInvitation: async issuerKeywordRecord => {
      await saveAllIssuers(zcf, issuerKeywordRecord);
      /** @type OfferHandler */
      const addInventory = seat => {
        assertProposalShape(seat, { want: {} });
        marketMakerSeat.incrementBy(
          seat.decrementBy(seat.getCurrentAllocation()),
        );
        zcf.reallocate(marketMakerSeat, seat);
        seat.exit();
        return 'Inventory added';
      };
      return zcf.makeInvitation(addInventory, 'addInventory');
    },
    makeRemoveInventoryInvitation: () => {
      /** @type OfferHandler */
      const removeInventory = seat => {
        const { want: seatWant } = seat.getProposal();
        seat.incrementBy(marketMakerSeat.decrementBy(seatWant));
        zcf.reallocate(seat, marketMakerSeat);
        seat.exit();
        return 'Inventory removed';
      };
      return zcf.makeInvitation(removeInventory, 'removeInventory');
    },
    makeQuote: async (assets, price, timeAuthority, deadline) => {
      const { creatorInvitation } = await E(zoe).startInstance(
        coveredCallInstallation,
        zcf.getTerms().issuers,
      );

      const proposal = harden({
        give: assets,
        want: price,
        exit: {
          afterDeadline: {
            timer: timeAuthority,
            deadline,
          },
        },
      });

      const payments = await withdrawFromSeat(zcf, marketMakerSeat, assets);

      const sellUserSeat = E(zoe).offer(creatorInvitation, proposal, payments);

      E(sellUserSeat)
        .getPayouts()
        .then(async payouts => {
          // TODO Stop using getCurrentAllocationJig.
          // See https://github.com/Agoric/agoric-sdk/issues/5833
          const amounts = await E(sellUserSeat).getCurrentAllocationJig();
          await depositToSeat(zcf, marketMakerSeat, amounts, payouts);
        });

      const option = E(sellUserSeat).getOfferResult();
      return option;
    },
  });
  return harden({ creatorFacet });
};

harden(start);
export { start };
