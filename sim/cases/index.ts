import type { TestCase } from '../core/types';
import { tc01 } from './tc01-oem-vehicle-data';
import { tc02 } from './tc02-car-happy';
import { tc03 } from './tc03-bike-happy';
import { tc04 } from './tc04-reports';
import { tc05 } from './tc05-not-in-oem-data';
import { tc06 } from './tc06-engine-mismatch';
import { tc07 } from './tc07-cancel';
import { tc08 } from './tc08-qc-reject';
import { tc09 } from './tc09-dealer-reject';
import { tc10 } from './tc10-vahan-down';
import { tc11 } from './tc11-emboss-ocr-mismatch';
import { tc12 } from './tc12-fitment-ocr-mismatch';
import { tc13 } from './tc13-postpaid-billing';
import { tc14 } from './tc14-oem-bulk-upload';

/**
 * Run order: happy flows first, then error flows (ids are stable, so later happy cases sit before TC-05). Add new
 * cases here (docs/SIMULATION.md, "Adding a test case").
 */
export const CASES: TestCase[] = [tc01, tc02, tc03, tc04, tc13, tc14, tc05, tc06, tc07, tc08, tc09, tc10, tc11, tc12];
