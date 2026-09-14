import { Column, Entity, PrimaryColumn } from 'typeorm';
import { KskModel } from '../constants';

/**
 * Tracks the newest "No." seen per model so fastScan() only has to compare
 * the list page's newest row against this value instead of re-scanning
 * everything.
 */
@Entity('scrape_state')
export class ScrapeState {
  @PrimaryColumn({ type: 'varchar' })
  model: KskModel;

  @Column({ name: 'last_seen_no', nullable: true })
  lastSeenNo: string | null;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
