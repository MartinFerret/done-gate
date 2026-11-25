// The "real system" of this example: a tiny in-memory booking calendar with one deliberate fault.
// The first booking is lost, and the caller is told it worked. Every later booking is stored.
// It is deterministic: the same fault on every run.

export interface Booking {
  readonly day: string;
  readonly time: string;
  readonly name: string;
}

export interface BookingSystem {
  /** Tells the caller "Booked." every time. The first call stores nothing. */
  book(booking: Booking): string;
  /** The truth: what is really stored. */
  list(): readonly Booking[];
}

export function createBookingSystem(): BookingSystem {
  const bookings: Booking[] = [];
  let writes = 0;
  return {
    book(booking: Booking): string {
      writes += 1;
      if (writes > 1) bookings.push(booking);
      return `Booked ${booking.day} ${booking.time} for ${booking.name}.`;
    },
    // A copy: what a caller was shown must not change when a later booking is stored.
    list: () => [...bookings],
  };
}
