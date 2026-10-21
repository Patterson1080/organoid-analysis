# Routing view round 2: the team's answers, and the arms — design

**Date:** 2026-10-21 · **Branch:** `routing-sound-fab` · **Builds on:** `2026-10-20-routing-sound-fab-design.md`, `2026-10-20-routing-view-design.md`

## The team's answers (2026-10-21)

| Question | Answer | What changes |
|---|---|---|
| Termite OBJ units | about 70 cm tall as built | the form is shown ≈ 70 cm (the OBJ's 571 units = 700 mm, so 1.23 mm a unit) |
| All 4 segments printed, bottom to top | yes | "4 printed segments", no ≈ |
| Which clay piece; how it pairs | the clay 3D-printed piece sits next to the termite plastic print | FAB draws both side by side at one scale, as installed |
| Arm 1 on serial with the serial patch open | yes | the arpeggio follows arm 1. When arm 1 doesn't report here, it follows the simulated arm 1, marked SIMULATED |
| Does anything fade the sound in OFF | no fade; "it just doesn't get triggered without organoid recording playing" | no new events while `/index` is still (OFF or paused); caption "silent while /index is still" |
| `backboneSpikes.txt` = the 27 backbone columns | should be | in the show, strikes are the rows Max sends (no ≈); in local playback ≈, since Max hears few rows |
| Max sends `/routing/sound/harmony` | it could | README: how to wire it in Max |
| `+ 1` in `termiteKick` | not sure | the view keeps mirroring the patch as wired |
| `metro 4800` / `metro 9600` | sure | the two arguments are added in `dev/audio/SimulacraNaturae_4ch_realtime.maxpat`, with a backup |

**Patch note.** In these files the metros start at load, and only `cueAudio` (never sent) moves the master gain. So the silence in OFF comes from outside these patches. The view follows the room.

## The arms (from `dev/arms`)

### Sources

- **`ProximityServoArms_Currents.ino`:** the CURRENTS show's sketch. It runs up to five arms on one board.
- **`modular/`:** Haptophylla, the plug-and-play rebuild planned for the next show. It covers `docs/PROTOCOL.md`, `docs/ARCHITECTURE.md`, `README.md`, `cad/params.py` and `cad/SPEC.md`.

### Facts the view states

- **Anatomy:** a pod on a pipe clamp, with the servo and pulley inside. Below it hangs a carbon strip spine with about 8 vertebrae and mylar leaves, plus a tendon 12 mm in front of the strip. At the end is a tip pod holding an ultrasonic sensor that points down the arm. The arm hangs upside down, so gravity swings it as the tendon pulls.
- **Sensing:** ultrasonic, 0–100 cm. No echo within about 6 ms reads as 100 cm, meaning nobody is there.
- **Motion:** the same rules in the sketch and in the rebuild's `currents` / `hybrid` modes.
  - **Mapping:** servo target = `map(d, 0, 100, 0, 180)` in integer arithmetic.
  - **Deadband:** the arm moves only when the target is more than 10° away.
  - **Speed:** it ramps at 200°/s (1° per 5 ms), settles for 100 ms, then cools down for 2 s: no reading, no moving.
  - **Blocking:** in the sketch, a ramping arm stalls the other arms' loops. The rebuild doesn't block.
- **Tendon:** the rebuild's pulley pulls 0.21 mm of tendon per degree. The view draws the bend in proportion to the angle.
- **Touch and fibres:** these are SIGGRAPH and rebuild features. Touched leaves fade the fibre light in over 1 s. The CURRENTS sketch senses proximity only.
- **To the sound:**
  - **CURRENTS:** serial at 115200. The CURRENTS sketch prints `proximitydata: <id>,<cm>`, but the Max serial patch routes `sensordata:`. The rebuild's legacy serial prints `sensordata:`.
  - **Rebuild:** sends OSC broadcast to Max on 9100.
  - **This view:** the rebuild mirrors arms 1–3 as `/routing/robot/<id>/{proximity,servo,touch}` to the bridge's UDP 3333.
- **Count:** the view shows arms 1–3, which is the routing telemetry's range and the rebuild's plan for the next show.

### What the view does

- **Model (pure, tested):**
  - `servoTarget(cm)`;
  - a per-arm state machine (listening → moving → settling → cooldown) with the deadband, slew, settle and cooldown;
  - a deterministic visitor process. It mostly reads "nobody", and every few tens of seconds a visitor comes within 15–60 cm for several seconds.
- **Telemetry:**
  - LIVE proximity drives the state machine.
  - LIVE servo overrides the angle.
  - LIVE touch drives the fibre fade.
  - Each value is labelled LIVE or SIMULATED.
- **Drawing:**
  - pipe, clamp and pod;
  - the spine as a curve through its vertebrae, with leaves and the tendon;
  - the tip pod with its ultrasonic cone (100 cm) and the visitor at the measured distance;
  - fibres glowing with the light level;
  - per arm: distance, angle and state (moving, cooldown and its countdown, listening).
- **Detail:**
  - the arms, large;
  - the distance → angle rule as a chart, with the deadband around each arm's angle;
  - per-arm rows;
  - the sketch's and the rebuild's facts;
  - the chain: visitor → ultrasonic → map → servo → tendon → spine → serial/OSC → Max → arpeggio.
- **Source panel:** visitors per arm in cm, closer = taller, with "nobody" at 100.

## FAB with the answers

- **Scale:** both objects are drawn at one scale on one ground line: the termite form ≈ 70 cm, the vessel 451 mm (its G-code height, before firing).
- **Labels:** "≈ 70 cm" and "451 mm".
- **Card:** the same pair at one scale.
- **Schematic:** places them side by side, to that scale. The frame, LEDs and fibres stay schematic.

## Not in scope

- Changing the arms' firmware or the Max serial patch: the prefix mismatch is reported, not fixed.
- More than 3 arms in the view.

## Unresolved questions

- Which arm firmware runs in this show: the CURRENTS sketch (`proximitydata:`) or the rebuild's legacy serial (`sensordata:`)? Only the latter reaches the arpeggio as the Max patch is wired.

## Amendments (during the build)

- **Drawn curl.** It's capped with the tip at about 45° at full pull. At the first, steeper setting, idle arms (nobody near means 180°) curled into hooks that crossed their neighbours.
- **Arm layout.** The arms anchor a little left of centre, and the panel is clipped, because every arm curls toward its tendon side.
- **Schematic heights.** The schematic draws the two pieces at their real heights (452 mm against ≈ 700 mm). Only the frame and fibres stay out of scale.
