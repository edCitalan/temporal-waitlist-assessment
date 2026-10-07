export type DemoStatus = {
  requestId: string;
  phase: "started" | "waiting" | "complete";
  message: string;
};

export type Service = "Haircut" | "Color" | "Highlights";

export type WaitlistEntry = {
  id: string;
  name: string;
  mobile: string;
  service: Service;
  stylistPreference: string;
  availability: "Any time" | "Weekdays" | "Weekends" | "Weekday afternoons";
  joinedAt: string;
  optedIn: boolean;
};

export type OpeningInput = {
  service: Service;
  stylist: string;
  startsAt: string;
  displayTime: string;
  durationMinutes: number;
};

export type Opening = OpeningInput & {
  id: string;
  createdAt: string;
  status: "queued" | "offering" | "booked" | "closed" | "unfilled";
  currentOfferId?: string;
  bookedClientId?: string;
  note: string;
};

export type Offer = {
  id: string;
  openingId: string;
  clientId: string;
  clientName: string;
  service: Service;
  stylist: string;
  startsAt: string;
  deadlineAt: string;
  status: "waiting" | "needs-follow-up" | "accepted" | "declined" | "expired" | "cancelled";
  message: string;
};

export type SalonSnapshot = {
  waitlist: WaitlistEntry[];
  openings: Opening[];
  offers: Offer[];
  offersRunning: boolean;
  lastUpdated: string;
};

export type ClientReply = {
  offerId: string;
  kind: "accept" | "decline" | "question";
  message?: string;
};

export type StaffCancellation = {
  openingId: string;
  stillOpen: boolean;
  reason: string;
};

