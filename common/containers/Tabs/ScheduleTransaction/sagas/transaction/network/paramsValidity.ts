import { SagaIterator, delay } from 'redux-saga';
import { select, fork, call, take, apply, put } from 'redux-saga/effects';
import { getOffline, getNodeLib } from 'selectors/config';
import {
  ICurrentSchedulingToggle,
  ICurrentWindowSize
} from 'containers/Tabs/ScheduleTransaction/selectors';
import {
  getSchedulingToggle,
  getScheduleTimestamp,
  getScheduleTimezone
} from '../../../selectors/fields';
import {
  TypeKeys,
  SetScheduleParamsValidityAction,
  setScheduleParamsValidity
} from 'actions/transaction';
import {
  getCurrentTo,
  getCurrentValue,
  getData,
  getScheduleType,
  getWindowStart,
  getWindowSize,
  getTimeBounty,
  getScheduleGasPrice,
  getScheduleGasLimit,
  getScheduleDeposit
} from 'selectors/transaction';
import { getWalletInst } from 'selectors/wallet';
import {
  EAC_SCHEDULING_CONFIG,
  calcEACEndowment,
  getValidateRequestParamsData,
  EAC_ADDRESSES,
  parseSchedulingParametersValidity
} from 'libs/scheduling';
import { gasPriceToBase } from 'libs/units';
import BN from 'bn.js';
import { bufferToHex } from 'ethereumjs-util';
import RequestFactory from 'libs/scheduling/contracts/RequestFactory';
import { dateTimeToUnixTimestamp, windowSizeBlockToMin } from 'selectors/transaction/helpers';

export function* shouldValidateParams(): SagaIterator {
  while (true) {
    yield take([
      TypeKeys.TO_FIELD_SET,
      TypeKeys.DATA_FIELD_SET,
      TypeKeys.CURRENT_TIME_BOUNTY_SET,
      TypeKeys.WINDOW_SIZE_FIELD_SET,
      TypeKeys.WINDOW_START_FIELD_SET,
      TypeKeys.SCHEDULE_TIMESTAMP_FIELD_SET,
      TypeKeys.TIME_BOUNTY_FIELD_SET,
      TypeKeys.SCHEDULE_TYPE_SET,
      TypeKeys.SCHEDULING_TOGGLE_SET,
      TypeKeys.SCHEDULE_TIMEZONE_SET
    ]);

    yield call(delay, 250);

    const isOffline: boolean = yield select(getOffline);
    const schedulingToggle: ICurrentSchedulingToggle = yield select(getSchedulingToggle);
    const scheduling = Boolean(schedulingToggle && schedulingToggle.value);

    if (isOffline || !scheduling) {
      continue;
    }

    yield call(checkSchedulingParametersValidity);
  }
}

function* checkSchedulingParametersValidity() {
  const currentTo = yield select(getCurrentTo);
  const currentValue = yield select(getCurrentValue);
  const callData = yield select(getData);
  const scheduleType = yield select(getScheduleType);
  const windowStart = yield select(getWindowStart);
  const windowSize: ICurrentWindowSize = yield select(getWindowSize);
  const timeBounty = yield select(getTimeBounty);
  const scheduleGasPrice = yield select(getScheduleGasPrice);
  const scheduleGasLimit = yield select(getScheduleGasLimit);
  const deposit = yield select(getScheduleDeposit);
  const node = yield select(getNodeLib);
  const wallet = yield select(getWalletInst);
  const scheduleTimestamp = yield select(getScheduleTimestamp);
  const scheduleTimezone = yield select(getScheduleTimezone);

  if (
    !currentValue.value ||
    !currentTo.value ||
    !scheduleGasPrice.value ||
    !wallet ||
    !windowSize.value
  ) {
    return;
  }

  const callGasLimit = scheduleGasLimit.value || EAC_SCHEDULING_CONFIG.SCHEDULE_GAS_LIMIT_FALLBACK;

  const endowment = calcEACEndowment(
    callGasLimit,
    currentValue.value || new BN(0),
    scheduleGasPrice.value || gasPriceToBase(EAC_SCHEDULING_CONFIG.SCHEDULE_GAS_PRICE_FALLBACK),
    timeBounty.value
  );

  const fromAddress = yield apply(wallet, wallet.getAddressString);

  const data = getValidateRequestParamsData(
    bufferToHex(currentTo.value),
    callData.value ? bufferToHex(callData.value) : '',
    callGasLimit,
    currentValue.value,
    windowSizeBlockToMin(windowSize.value, scheduleType.value) || 0,
    scheduleType.value === 'time'
      ? dateTimeToUnixTimestamp(scheduleTimestamp, scheduleTimezone.value)
      : windowStart.value,
    scheduleGasPrice.value,
    timeBounty.value,
    deposit.value || new BN(0),
    scheduleType.value === 'time',
    endowment,
    fromAddress
  );

  const callResult: string = yield apply(node, node.sendCallRequest, [
    {
      to: EAC_ADDRESSES.KOVAN.requestFactory,
      data
    }
  ]);

  const { paramsValidity } = RequestFactory.validateRequestParams.decodeOutput(callResult);

  const errors = parseSchedulingParametersValidity(paramsValidity);
  const paramsValid = errors.length === 0;

  yield call(setField, {
    raw: paramsValid,
    value: paramsValid
  });
}

export function* setField(payload: SetScheduleParamsValidityAction['payload']) {
  yield put(setScheduleParamsValidity(payload));
}

export const schedulingParamsValidity = fork(shouldValidateParams);
