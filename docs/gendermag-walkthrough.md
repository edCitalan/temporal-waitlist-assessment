# GenderMag-informed walkthrough

This is a lightweight, task-based walkthrough informed by [GenderMag](https://gendermag.org/gendermag.php), not a formal empirical evaluation. It uses the Abi persona as a design lens; it does not assume Lena shares any persona's cognitive style because of her gender.

## Scenario

Carla sees a same-day cancellation, adds the exact service, stylist, time, and length, starts the queue, handles an unclear client response, then sees a clear acceptance and updates Square.

## Walkthrough observations

| Facet lens | Check during the scenario | Current support |
| --- | --- | --- |
| Motivation | Can Carla quickly see how this helps fill the slot? | The opening status and next action stay together; accepted openings name the client and remind staff to update Square. |
| Information processing | Can she inspect the details and rules before committing? | Service, stylist, exact date/time, duration, waitlist match criteria, ordering, and the 15-minute window are visible. Openings can be queued before staff starts sequential offers. |
| Computer self-efficacy | Is the next action understandable, and is feedback visible? | Numbered steps explain offer, wait, and move-on; form feedback confirms actions; simulated outcomes remain visible in the offer history. |
| Attitude toward risk | Can she see what an action will do and avoid accidental real contact? | The page and every message say “SIMULATED”; the interface says no SMS is sent and Square is not connected. Only a clear acceptance marks the opening booked. |
| Learning style | Can she learn the flow while doing the task? | The dashboard gives a short sequence and uses labeled controls for clear yes, decline, question, cancel-and-try-next, and close. |

## Change made

The queue button now says “Start sequential offers” and shows the number of openings. This makes the one-at-a-time behavior visible at the point where staff begin the process.

The final walkthrough also added explicit late/repeated-reply outcomes, a staff-selected practical cutoff with visible time-zone guidance, and cancellation controls with distinct consequences. A polling refresh no longer replaces unchanged controls, preserving keyboard focus. Simulated outcomes stay visible so staff can inspect what happened. The seven browser check groups in `scripts/browser-check.mjs` exercised these controls and inspected desktop/mobile layouts.

The completed access revision adds a two-account staff selector, an optional show-password control, a plain-language sign-in error, a visible signed-in name, and a sign-out control. Nine browser check groups now cover the existing offer flow plus Lena's and Carla's sign-in, rejected access and logout. Sign-in assistance is kept on the login screen; generated credential file locations are documented for the local evaluator.

## Scope of this review

This walkthrough checks discoverability and feedback in the staff cancellation flow. It does not test the interface with salon staff or evaluate real SMS, Square, travel-time, or waitlist-maintenance integrations; those are outside this local prototype.
