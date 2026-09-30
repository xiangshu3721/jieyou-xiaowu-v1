import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export interface StoredAppointmentState {
  requestId: string;
  status: 'processing' | 'submitted' | 'failed';
  recordId?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

function readAll(): Record<string, StoredAppointmentState> {
  try {
    return JSON.parse(fs.readFileSync(config.appointmentStateFile, 'utf8')) as Record<string, StoredAppointmentState>;
  } catch {
    return {};
  }
}

function writeAll(states: Record<string, StoredAppointmentState>) {
  fs.mkdirSync(path.dirname(config.appointmentStateFile), { recursive: true });
  fs.writeFileSync(config.appointmentStateFile, JSON.stringify(states, null, 2));
}

export function getAppointmentState(requestId: string) {
  return readAll()[requestId];
}

export function saveAppointmentState(state: StoredAppointmentState) {
  const states = readAll();
  states[state.requestId] = state;
  writeAll(states);
}
