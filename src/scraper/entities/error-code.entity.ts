import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { KskRecord } from './ksk-record.entity';

/**
 * One row of the error-code sub-table shown on a KSK detail page
 * (Szczegol.php?numer=X&model=Y) — code, description, error producer,
 * part type/name, cavity, info.
 */
@Entity('ksk_error_codes')
export class ErrorCodeEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'ksk_record_id' })
  kskRecordId: number;

  @ManyToOne(() => KskRecord, (record) => record.errorCodes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'ksk_record_id' })
  kskRecord: KskRecord;

  @Column()
  code: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'error_producer', nullable: true })
  errorProducer: string | null;

  @Column({ name: 'part_type', nullable: true })
  partType: string | null;

  @Column({ name: 'part_name', nullable: true })
  partName: string | null;

  @Column({ nullable: true })
  cavity: string | null;

  @Column({ type: 'text', nullable: true })
  info: string | null;
}
