import { useContext, useReducer, useEffect } from 'react';
import '../App.css';
import { StatusContext } from './StatusContext';
import { IToast } from './interfaces';
import { IIdentified } from '../data/identified';

import Toast from 'react-bootstrap/Toast';

// Reports the toasts in the status context.

interface IToastElementProps {
  toast: IToast;
  remove: () => void;
}

function ToastElement(props: IToastElementProps) {
  return (
    <Toast onClose={props.remove}>
      <Toast.Header>
        <strong className="me-auto">{props.toast.title}</strong>
      </Toast.Header>
      <Toast.Body>
        {props.toast.message}
      </Toast.Body>
    </Toast>
  );
}

function ToastCollection() {
  const statusContext = useContext(StatusContext);
  const [toasts, setToasts] = useReducer((state: IIdentified<IToast>[], action: IIdentified<IToast | undefined>) => {
    const newState = state.filter(t => t.id !== action.id);
    if (action.record !== undefined) {
      newState.splice(0, 0, { id: action.id, record: action.record });
    }
    return newState;
  }, []);

  useEffect(() => {
    const sub = statusContext?.toasts.subscribe(setToasts);
    return () => { sub?.unsubscribe(); };
  }, [statusContext]);

  return (
    <div className="App-toast-container">
      {toasts.map(t => (
        <ToastElement key={t.id} toast={t.record} remove={() => setToasts({ id: t.id, record: undefined })} />
      ))
      }
    </div>
  );
}

export default ToastCollection;