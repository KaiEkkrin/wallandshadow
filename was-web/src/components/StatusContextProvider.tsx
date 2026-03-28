import { Subject } from 'rxjs';

import { StatusContext } from './StatusContext';
import { IContextProviderProps, IToast } from './interfaces';
import { IIdentified } from '@wallandshadow/shared';

const value = {
  toasts: new Subject<IIdentified<IToast | undefined>>()
};

function StatusContextProvider(props: IContextProviderProps) {
  return (
    <StatusContext.Provider value={value}>
      {props.children}
    </StatusContext.Provider>
  );
}

export default StatusContextProvider;