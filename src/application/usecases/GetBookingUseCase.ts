import { ApiError } from '@/lib/api/errors';
import type { BookingRecord, BookingRepository } from '@/application/ports/BookingRepository';
import { QueryUseCase, type ExecutionContext, type UseCaseDependencies } from '../shared/UseCase';

export interface GetBookingInput {
  readonly id: string;
  readonly userId: string;
}

/** `GET /api/bookings/:id` — §5.2. */
export class GetBookingUseCase extends QueryUseCase<GetBookingInput, BookingRecord> {
  public readonly name = 'get_booking';

  constructor(deps: UseCaseDependencies, private readonly bookings: BookingRepository) {
    super(deps);
  }

  protected async handle(input: GetBookingInput, _ctx: ExecutionContext): Promise<BookingRecord> {
    const record = await this.bookings.findById(input.id, input.userId);
    if (!record) throw ApiError.notFound('Booking');
    return record;
  }
}
