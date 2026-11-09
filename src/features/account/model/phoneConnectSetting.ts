import { storedFlag } from "../../../shared/lib/storedSetting";

/** Local only and off by default: "Let my signed-in phones find this computer". */
const KEY = "bycoda.account.phoneConnect";
const EVENT = "bycoda:phone-connect-change";

const flag = storedFlag(KEY, false, EVENT, true);

export const isPhoneConnectEnabled = (): boolean => flag.load() === true;
export const setPhoneConnectEnabled = (value: boolean): void => flag.save(value);
export const subscribePhoneConnect = flag.subscribe;
