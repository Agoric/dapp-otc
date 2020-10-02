// @ts-check
import '@agoric/zoe/exported';
import harden from '@agoric/harden';
import {
  trade,
  saveAllIssuers,
  assertProposalShape,
  withdrawFromSeat,
  depositToSeat,
} from '@agoric/zoe/src/contractSupport';
import { E } from '@agoric/eventual-send';

/**

 * @param {ContractFacet} zcf
 *
 */
const start = async zcf => {
  const { coveredCallInstallation } = zcf.getTerms();
  const { zcfSeat: marketMakerSeat } = zcf.makeEmptySeatKit();
  const zoe = zcf.getZoeService();

  const creatorFacet = {
    makeAddInventoryInvitation: async issuerKeywordRecord => {
      await saveAllIssuers(zcf, issuerKeywordRecord);
      /** @type OfferHandler */
      const addInventory = seat => {
        assertProposalShape(seat, { want: {} });
        trade(
          zcf,
          {
            seat: marketMakerSeat,
            gains: seat.getCurrentAllocation(),
          },
          { seat, gains: {} },
        );
        seat.exit();
        return 'Inventory added';
      };
      return zcf.makeInvitation(addInventory, 'addInventory');
    },
    makeRemoveInventoryInvitation: () => {
      /** @type OfferHandler */
      const removeInventory = seat => {
        trade(
          zcf,
          {
            seat: marketMakerSeat,
            gains: {},
          },
          { seat, gains: seat.getProposal().want },
        );
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
          const amounts = await E(sellUserSeat).getCurrentAllocation();
          await depositToSeat(zcf, marketMakerSeat, amounts, payouts);
        });

      const option = E(sellUserSeat).getOfferResult();
      return option;
    },
  };
  return harden({ creatorFacet });
};

harden(start);
export { start };
