import { createContext } from 'react';
import { Subject } from 'rxjs';

import { IStatusContext, IToast } from './interfaces';
import { IIdentified } from '../data/identified';

const value = {
  toasts: new Subject<IIdentified<IToast | undefined>>()
};

export const StatusContext = createContext<IStatusContext>(value);
