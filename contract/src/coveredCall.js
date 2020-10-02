// @ts-check
import '@agoric/zoe/exported';
import harden from '@agoric/harden';
import { swapExact } from '@agoric/zoe/src/contractSupport';

/**

 * @param {ContractFacet} zcf
 *
 */
const start = async zcf => {
  /** @type OfferHandler */
  const makeCallOption = sellSeat => {
    /** @type OfferHandler */
    const exerciseOption = buySeat => {
      swapExact(zcf, sellSeat, buySeat);
      return 'Offer was exercised';
    };
    const customProperties = harden({
      underlyingAssets: sellSeat.getProposal().give,
      strikePrice: sellSeat.getProposal().want,
      timeAuthority: sellSeat.getProposal().exit.afterDeadline.timer,
      deadline: sellSeat.getProposal().exit.afterDeadline.deadline,
    });
    const option = zcf.makeInvitation(
      exerciseOption,
      'exerciseOption',
      customProperties,
    );
    return option;
  };
  const creatorInvitation = zcf.makeInvitation(
    makeCallOption,
    'makeCallOption',
  );

  return harden({ creatorInvitation });
};

harden(start);
export { start };
