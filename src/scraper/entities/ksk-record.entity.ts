import {
  AfterLoad,
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { DATE_COLUMN_TYPE } from '../../database.config';
import { KskModel } from '../constants';
import { getIsoWeekLabel } from '../util/iso-week.util';
import { ErrorCodeEntry } from './error-code.entity';

export type KskStatus = 'En cours' | 'Terminé';

/**
 * Mirrors one row of the "Details" table (Szczegol.php?AK=1) merged with the
 * fields found on its detail page (Szczegol.php?numer=X&model=Y).
 *
 * `status`, `week`, and `durationMinutes` are derived, not scraped — they are
 * never persisted as columns. They're recomputed on load (@AfterLoad) and
 * must also be recomputed manually (`computeDerived()`) anywhere an entity
 * is built or mutated outside of a DB read (e.g. right after `save()`,
 * since TypeORM does not fire @AfterLoad on writes).
 */
@Entity('ksk_records')
@Unique('UQ_ksk_no_model', ['no', 'model'])
export class KskRecord {
  @PrimaryGeneratedColumn()
  id: number;

  /** "No." column from the list page. Unique per model, not globally. */
  @Index()
  @Column()
  no: string;

  @Index()
  @Column({ type: 'varchar' })
  model: KskModel;

  @Column({ name: 'car_id' })
  carId: string;

  @Column()
  zsb: string;

  @Column({ type: DATE_COLUMN_TYPE })
  registered: Date;

  /** Null while the rework is still in progress. */
  @Column({ type: DATE_COLUMN_TYPE, nullable: true })
  reworked: Date | null;

  @Column({ name: 'quality_control_date', type: DATE_COLUMN_TYPE, nullable: true })
  qualityControlDate: Date | null;

  @Column({ name: 'defect_shift', nullable: true })
  defectShift: string | null;

  @Column({ name: 'detect_shift', nullable: true })
  detectShift: string | null;

  @Column({ name: 'defect_by', nullable: true })
  defectBy: string | null;

  @Column({ name: 'error_code', nullable: true })
  errorCode: string | null;

  @Column({ name: 'part_type', nullable: true })
  partType: string | null;

  @Column({ name: 'part_name', nullable: true })
  partName: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'text', nullable: true })
  comment: string | null;

  /** Color swatch shown on the list page. */
  @Column({ nullable: true })
  color: string | null;

  /**
   * Station where the defect was caught ("Reworked From" on the detail page).
   * Only the live scraper can populate this reliably; it drives the
   * "Reworked From — Quality Gate" breakdown.
   */
  @Column({ name: 'quality_gate', nullable: true })
  qualityGate: string | null;

  /**
   * When the detail page was last fetched SUCCESSFULLY. Null means the record
   * is known only from the list page (e.g. just backfilled) — its status and
   * duration are not real yet, so the API hides it until this is set.
   */
  @Index()
  @Column({ name: 'detail_fetched_at', type: DATE_COLUMN_TYPE, nullable: true })
  detailFetchedAt: Date | null;

  /**
   * When the detail page was last ATTEMPTED, success or not. Drives re-check
   * spacing and retry back-off, so one record that keeps failing cannot
   * monopolise every detail cycle.
   */
  @Column({ name: 'detail_checked_at', type: DATE_COLUMN_TYPE, nullable: true })
  detailCheckedAt: Date | null;

  /**
   * `orphanedRowAction: 'delete'` so a code the site no longer lists is removed
   * rather than left behind: operators can replace the main error code during
   * Rework Out (rework system manual §4.2). Safe because the relation is eager
   * — a loaded record always carries its current rows — and because the
   * scraper never overwrites this list from an empty page (see syncErrorCodes).
   */
  @OneToMany(() => ErrorCodeEntry, (entry) => entry.kskRecord, {
    cascade: true,
    eager: true,
    orphanedRowAction: 'delete',
  })
  errorCodes: ErrorCodeEntry[];

  // ---- computed, not persisted (see class doc) ----
  status: KskStatus;
  week: string;
  durationMinutes: number;
  /**
   * Repaired but not yet released by the quality worker.
   *
   * The rework system has three stages: Rework In (registered) → Rework Out
   * (reworked) → Quality Control, which is what actually closes the Rework ID
   * (manual §5). `status` stays two-valued because the repair is what the
   * duration measures, but a harness in this state is not released yet.
   */
  awaitingQualityControl: boolean;

  @AfterLoad()
  computeDerived(): void {
    this.status = this.reworked ? 'Terminé' : 'En cours';
    this.awaitingQualityControl = this.reworked !== null && this.qualityControlDate === null;
    this.week = getIsoWeekLabel(new Date(this.registered));
    const end = this.reworked ? new Date(this.reworked) : new Date();
    this.durationMinutes = Math.max(
      0,
      Math.round((end.getTime() - new Date(this.registered).getTime()) / 60_000),
    );
  }
}
