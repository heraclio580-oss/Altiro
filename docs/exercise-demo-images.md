# Altiro exercise demo images: spec & checklist

Altiro shows a short looping demo beside every exercise in a generated workout. If you make these images, the app will show yours instead of the drawn figure. Any exercise without an image keeps the drawn figure, so you can add them a few at a time.

There are **131 moves** in total: **105 lifting exercises** (Part A) and **26 core, mobility and stretching moves** (Part B), which are also used in generated workouts. Two breathing exercises in Part B are optional.

A spreadsheet version for tracking progress is in `docs/exercise-demo-checklist.csv`.

---

## 1. File format (pick one, and use it for all of them)

| Option | What to send | Notes |
|---|---|---|
| **A. Animated WebP** (best) | `back-squat.webp` | Looks like a GIF, but 5–10× smaller. Supports a transparent background. |
| **B. Animated GIF** | `back-squat.gif` | Works everywhere, just heavier. Keep each under ~300 KB. |
| **C. MP4 video** | `back-squat.mp4` | H.264, no sound. Can't be transparent, so use a plain white background. |
| **D. Two stills** | `back-squat-start.png` + `back-squat-end.png` | Easiest from an image generator. The app animates smoothly back and forth between them. Both frames need the **identical** character, framing and scale; only the body position changes. |

## 2. Size & framing

- **Canvas:** 600 × 600 px, square.
- **The figure** fills about 80% of the height, with feet near the bottom edge and a little space all around.
- **The same scale for every exercise.** A standing person should be about the same height in every image, so the set looks consistent side by side.
- **Floor exercises** (push-up, plank, bridge) are shown lower in the frame, at the same body scale. Don't zoom in to fill the square.

## 3. Background

- **Transparent is best** (WebP, PNG or GIF). The app puts it on its own card, so it looks right in both dark and light mode.
- **If transparent isn't possible,** use **plain white (#FFFFFF)**, with no floor texture, shadow gradient or scenery. The app will show it on a white rounded card in both themes.
- A simple thin floor line or a soft shadow under the feet is fine.

## 4. Style (must match across all of them)

- **Flat illustration,** like the squat example you sent: clean shapes and no photo realism.
- **The same person in every image:** same body type, skin tone, hair and outfit. For example, blue tank top, dark shorts, light shoes.
- **The same equipment look everywhere:** black plates with a silver bar, dark dumbbells and kettlebells, a gray bench.
- **Side views face right.** "View" in the tables says which angle shows the move best.
- **One-sided moves** (single-arm row, split squat, and so on): show the working arm or leg on the side nearest the camera.
- **No text, labels, arrows, logos or watermarks** inside the image.

## 5. Motion (for animated formats)

- **One clean rep per loop,** 1.5–3 seconds long, at a steady controlled tempo, looping seamlessly (the last frame matches the first).
- **12–20 frames per second** is plenty.
- **Holds** (plank, wall sit, stretches) can be a single still image with the same file name, for example `plank.webp`.

## 6. File names

- Use exactly the name in the **File name** column, plus the extension: `back-squat.webp`, `worlds-greatest-stretch.webp`.
- Lowercase, with hyphens and no spaces. For two-stills format, add `-start` and `-end`.

## 7. Rights (important)

- **Commercial use:** you need the right to use the images in a commercial app. If you use an AI image tool, check that its terms allow this; most paid plans do.
- **No stock images with watermarks** (Dreamstime, Shutterstock and similar) unless you've bought the license.
- **No real person's likeness,** such as a celebrity or a real athlete.
- **Keep a note of the tool and plan you used,** in case it's ever asked.

## 8. Sending them to me

- **A few at a time:** attach them in the chat.
- **The full set:** on GitHub, open the Altiro repo, go to **Add file → Upload files**, drop them into a folder named `www/demos/`, and commit. Then tell me, and I'll hook them up and check each one in the app.
- **Partial sets are fine.** Missing ones keep the drawn figure.

## 9. A prompt you can reuse (for AI image tools)

Keep everything except the last line the same for every exercise, so the character and style stay consistent:

> Flat vector illustration of a fit adult athlete, short brown hair, blue tank top, dark gray shorts, light gray sneakers, simple clean shapes, no outlines, no text, no watermark, plain white background, full body, centered, square 1:1. Side view, facing right.
> **Exercise:** *[paste "What to show" from the table, e.g. "Standing tall, bar on upper back → hips back and down until thighs are about parallel, knees over toes, chest up"]*, holding *[Equipment]*.

For the two-stills format, generate the **start** and **end** positions as two images with the same prompt and the same seed or character reference. Change only the position description.

---

## Part A: Lifting exercises (105)

| # | Exercise | File name (add the extension) | Equipment | View | What to show (start → end) |
|---|---|---|---|---|---|
| 1 | Back Squat | `back-squat` | Barbell on upper back | Side | Standing tall, bar on upper back → hips back and down until thighs are about parallel, knees over toes, chest up. |
| 2 | Front Squat | `front-squat` | Barbell on front of shoulders | Side | Bar resting on front of shoulders, elbows high → squat to about parallel with torso upright → stand. |
| 3 | Leg Press | `leg-press` | Leg press machine | Side | Seated in the machine, feet on the platform, legs nearly straight → knees bend toward chest → press back out. |
| 4 | Goblet Squat | `goblet-squat` | One dumbbell held at chest | Side | Dumbbell held vertically at the chest → squat to about parallel, elbows inside knees → stand. |
| 5 | Kettlebell Sumo Squat | `kettlebell-sumo-squat` | One kettlebell | Front | Wide stance, toes turned out, kettlebell hanging in both hands → squat straight down → stand. |
| 6 | Dumbbell Step-Up | `dumbbell-step-up` | Dumbbells + box/bench | Side | Dumbbells at sides, one foot on the box → drive up to stand on the box → step back down. |
| 7 | Bodyweight Squat | `bodyweight-squat` | None | Side | Standing, arms forward for balance → hips back and down to about parallel → stand. |
| 8 | Jump Squat | `jump-squat` | None | Side | Squat down to about parallel → explode up, feet leaving the floor → land softly back into the squat. |
| 9 | Wall Sit | `wall-sit` | Wall | Side | Back flat against a wall, knees at 90°, thighs parallel to the floor. A hold: little or no motion (a still image is fine). |
| 10 | Walking Lunge | `walking-lunge` | Dumbbells at sides | Side | Step forward, lower until both knees are at about 90° (back knee near the floor) → drive up and step through into the next lunge. |
| 11 | Bulgarian Split Squat | `bulgarian-split-squat` | Dumbbells + bench | Side | Rear foot resting on a bench behind, front foot forward → lower until front thigh is about parallel → stand. |
| 12 | Step-Up | `step-up` | Box/bench (weight optional) | Side | One foot on the box → drive up to stand on it → step back down. |
| 13 | Reverse Lunge | `reverse-lunge` | None | Side | Standing → step one foot back and lower until both knees are at about 90° → return to standing. |
| 14 | Bodyweight Split Squat | `bodyweight-split-squat` | None | Side | Staggered stance, one foot forward one back → lower straight down until back knee nears the floor → rise. |
| 15 | Bodyweight Step-Up | `bodyweight-step-up` | Box/step | Side | One foot on the step → step up to stand on it → step back down. |
| 16 | Deadlift | `deadlift` | Barbell on floor | Side | Bar over mid-foot, hips back, flat back, hands on bar → stand tall with the bar at the hips → lower back to the floor. |
| 17 | Trap Bar Deadlift | `trap-bar-deadlift` | Trap (hex) bar | Side | Standing inside the hex bar, hips back, flat back → stand tall → lower. |
| 18 | Rack Pull | `rack-pull` | Barbell on rack pins at knee height | Side | Bar starts on pins just below the knees → stand tall → lower back to the pins. |
| 19 | Romanian Deadlift | `romanian-deadlift` | Barbell | Side | Standing with bar at hips, soft knees → push hips back, bar slides down thighs to mid-shin, back flat → stand. |
| 20 | Hip Thrust | `hip-thrust` | Barbell + bench | Side | Upper back on a bench, bar across hips, feet flat → drive hips up until body is flat from knees to shoulders → lower. |
| 21 | Good Morning | `good-morning` | Barbell on upper back | Side | Standing, bar on upper back → hinge at the hips, back flat, until torso is near parallel → stand. |
| 22 | Dumbbell Romanian Deadlift | `dumbbell-romanian-deadlift` | Dumbbells | Side | Dumbbells in front of thighs → hips back, dumbbells slide to mid-shin, back flat → stand. |
| 23 | Kettlebell Swing | `kettlebell-swing` | One kettlebell | Side | Kettlebell hiked back between the legs, hips back → snap hips forward, bell swings to chest height, arms straight → swing back. |
| 24 | Dumbbell Hip Thrust | `dumbbell-hip-thrust` | Dumbbell + bench | Side | Upper back on a bench, dumbbell on hips → drive hips up to a flat line → lower. |
| 25 | Single-Leg Romanian Deadlift | `single-leg-romanian-deadlift` | None | Side | Standing on one leg → hinge forward, free leg extends straight back, body forms a T → return to standing. |
| 26 | Glute Bridge | `glute-bridge` | None | Side | Lying on back, knees bent, feet flat → lift hips until knees, hips, shoulders line up → lower. |
| 27 | Single-Leg Glute Bridge | `single-leg-glute-bridge` | None | Side | Lying on back, one foot flat, other leg straight up or out → lift hips on one leg → lower. |
| 28 | Bench Press | `bench-press` | Barbell + flat bench | Side | Lying on bench, bar over chest, arms straight → lower bar to mid-chest, elbows about 45° → press up. |
| 29 | Incline Barbell Press | `incline-barbell-press` | Barbell + incline bench | Side | On an incline bench (~30°), bar over upper chest → lower to upper chest → press up. |
| 30 | Dumbbell Bench Press | `dumbbell-bench-press` | Dumbbells + flat bench | Side | Lying on bench, dumbbells over chest → lower to chest level → press up. |
| 31 | Incline Dumbbell Press | `incline-dumbbell-press` | Dumbbells + incline bench | Side | On an incline bench, dumbbells over upper chest → lower → press up. |
| 32 | Dumbbell Floor Press | `dumbbell-floor-press` | Dumbbells, on floor | Side | Lying on the floor, knees bent, dumbbells over chest → lower until upper arms touch the floor → press up. |
| 33 | Chest Fly | `chest-fly` | Dumbbells + flat bench | Front (from the feet end) or 3/4 | Lying on bench, dumbbells together over chest, slight elbow bend → open arms wide in an arc → bring back together. |
| 34 | Cable Fly | `cable-fly` | Cable machine, two handles | Front or 3/4 | Standing between cables, arms out wide → bring hands together in front of the chest in an arc → open back. |
| 35 | Dumbbell Floor Fly | `dumbbell-floor-fly` | Dumbbells, on floor | Front or 3/4 | Lying on the floor, dumbbells over chest → arms open wide until elbows touch the floor → bring back together. |
| 36 | Push-Up | `push-up` | None | Side | Straight plank on hands, hands under shoulders → lower chest near the floor, elbows back ~45° → push up. |
| 37 | Incline Push-Up | `incline-push-up` | Bench/box | Side | Hands on a bench, body straight → lower chest to the bench → push up. |
| 38 | Decline Push-Up | `decline-push-up` | Bench/box | Side | Feet on a bench, hands on the floor → lower chest near the floor → push up. |
| 39 | Diamond Push-Up | `diamond-push-up` | None | Side or 3/4 | Push-up with hands close together under the chest (index fingers and thumbs touching) → lower → push up, elbows close to the body. |
| 40 | Overhead Press | `overhead-press` | Barbell | Side | Standing, bar at front of shoulders → press straight overhead to lockout, head moves through → lower. |
| 41 | Push Press | `push-press` | Barbell | Side | Bar at shoulders → small knee dip → drive up with the legs and press overhead → lower. |
| 42 | Arnold Press | `arnold-press` | Dumbbells | Front | Seated/standing, dumbbells at chest, palms facing you → rotate palms out while pressing overhead → reverse. |
| 43 | Dumbbell Shoulder Press | `dumbbell-shoulder-press` | Dumbbells | Front | Dumbbells at shoulder height, palms forward → press overhead → lower. |
| 44 | Pike Push-Up | `pike-push-up` | None | Side | Hips high in an inverted V, hands and feet on floor → bend elbows, head lowers toward the floor → push back up. |
| 45 | Bent-Over Row | `bent-over-row` | Barbell | Side | Hinged forward, back flat, bar hanging → pull bar to lower ribs → lower. |
| 46 | Seated Cable Row | `seated-cable-row` | Cable row machine | Side | Seated, arms straight to the handle → pull to the stomach, chest up → return. |
| 47 | T-Bar Row | `t-bar-row` | T-bar / landmine | Side | Straddling the bar, hinged forward → pull the handle to the chest → lower. |
| 48 | Dumbbell Row | `dumbbell-row` | Dumbbell + bench | Side | One knee and hand on a bench, back flat, dumbbell hanging → pull elbow up toward the hip → lower. |
| 49 | Resistance Band Row | `resistance-band-row` | Resistance band | Side | Band anchored in front (or around the feet, seated), arms straight → pull hands to the stomach → return. |
| 50 | Inverted Row | `inverted-row` | Bar at waist height | Side | Hanging under a bar, body straight, heels on floor → pull chest to the bar → lower. |
| 51 | Superman | `superman` | None | Side | Lying face down, arms overhead → lift arms, chest and legs off the floor → lower. |
| 52 | Pull-Up | `pull-up` | Pull-up bar | Side or back | Hanging, palms facing away → pull up until chin is over the bar → lower. |
| 53 | Chin-Up | `chin-up` | Pull-up bar | Side | Hanging, palms facing you → pull chin over the bar → lower. |
| 54 | Lat Pulldown | `lat-pulldown` | Lat pulldown machine | Side or front | Seated, arms up holding the bar → pull bar to upper chest → return. |
| 55 | Dumbbell Pullover | `dumbbell-pullover` | Dumbbell + bench | Side | Lying on bench, dumbbell over chest in both hands → lower it back behind the head in an arc → return. |
| 56 | Prone Y-T-W Raise | `prone-y-t-w-raise` | None | Top-down or side | Lying face down → arms raise in a Y, then a T, then a W shape, lifting a little off the floor each time. |
| 57 | Bicep Curl | `bicep-curl` | Dumbbells | Side | Dumbbells at sides, palms forward → curl up to the shoulders, elbows still → lower. |
| 58 | Hammer Curl | `hammer-curl` | Dumbbells | Side | Dumbbells at sides, palms facing in → curl up → lower. |
| 59 | Triceps Pushdown | `triceps-pushdown` | Cable machine | Side | Elbows at sides, forearms up → push down until arms are straight → return. |
| 60 | Overhead Triceps Extension | `overhead-triceps-extension` | One dumbbell | Side | Dumbbell held overhead with both hands → lower behind the head, elbows up → extend. |
| 61 | Triceps Dip | `triceps-dip` | Parallel bars | Side | Supported on bars, arms straight → lower until elbows are about 90° → push up. |
| 62 | Bench Dip | `bench-dip` | Bench | Side | Hands on a bench behind you, legs out in front → lower until elbows are about 90° → push up. |
| 63 | Face Pull | `face-pull` | Cable machine with rope | Side | Rope at face height, arms straight → pull rope toward the face, elbows high and out → return. |
| 64 | Reverse Fly | `reverse-fly` | Dumbbells | Side or 3/4 | Bent over, dumbbells hanging → open arms out to the sides, squeezing shoulder blades → lower. |
| 65 | Band Pull-Apart | `band-pull-apart` | Resistance band | Front | Arms straight in front holding a band → pull hands apart until the band touches the chest → return. |
| 66 | Calf Raise | `calf-raise` | None (optional step) | Side | Standing → rise up onto the balls of the feet → lower heels. |
| 67 | Single-Leg Calf Raise | `single-leg-calf-raise` | None (optional step) | Side | On one foot → rise onto the ball of the foot → lower. |
| 68 | Plank | `plank` | None | Side | Forearms and toes, body in a straight line. A hold: a still image is fine. |
| 69 | Dead Bug | `dead-bug` | None | Side | On back, arms up, knees at 90° → lower opposite arm and leg toward the floor → return, switch sides. |
| 70 | Side Plank | `side-plank` | None | Front | On one forearm and the side of the feet, body in a straight line. A hold: a still image is fine. |
| 71 | Bicycle Crunch | `bicycle-crunch` | None | Side or 3/4 | On back, hands by head → bring one elbow toward the opposite knee while the other leg extends → switch. |
| 72 | Kettlebell Front Squat | `kettlebell-front-squat` | Two kettlebells (or one) in front rack | Side | Bells held at the shoulders → squat to about parallel → stand. |
| 73 | Kettlebell Reverse Lunge | `kettlebell-reverse-lunge` | Kettlebell | Side | Bell held at chest or at sides → step back into a lunge → return. |
| 74 | Kettlebell Split Squat | `kettlebell-split-squat` | Kettlebell | Side | Staggered stance, bell held at chest → lower back knee toward the floor → rise. |
| 75 | Kettlebell Deadlift | `kettlebell-deadlift` | Kettlebell on floor | Side | Bell between the feet, hips back, flat back → stand tall → lower. |
| 76 | Single-Leg Kettlebell Deadlift | `single-leg-kettlebell-deadlift` | Kettlebell | Side | Bell in one hand, standing on one leg → hinge forward, free leg back → stand. |
| 77 | Kettlebell Clean | `kettlebell-clean` | Kettlebell | Side | Bell hanging between the legs → hip snap brings the bell up to rest at the shoulder (front rack) → lower. |
| 78 | Kettlebell Floor Press | `kettlebell-floor-press` | Kettlebell, on floor | Side | Lying on floor, bell in one hand at the chest → press up → lower. |
| 79 | Kettlebell Overhead Press | `kettlebell-overhead-press` | Kettlebell | Side or front | Bell at the shoulder → press overhead → lower. |
| 80 | Kettlebell Push Press | `kettlebell-push-press` | Kettlebell | Side | Bell at shoulder → small knee dip → drive and press overhead → lower. |
| 81 | Kettlebell Halo | `kettlebell-halo` | Kettlebell | Front | Bell held upside down by the horns at the chest → circle it around the head → back to the chest. |
| 82 | Kettlebell Row | `kettlebell-row` | Kettlebell | Side | Hinged forward (hand on bench or knee), bell hanging → row to the hip → lower. |
| 83 | Kettlebell Gorilla Row | `kettlebell-gorilla-row` | Two kettlebells | Side or 3/4 | Wide stance, hinged forward, bells on floor between feet → row one bell up while the other stays down → switch. |
| 84 | Kettlebell High Pull | `kettlebell-high-pull` | Kettlebell | Side | Bell hanging → hip snap, pull the bell up to chest height, elbow high → lower. |
| 85 | Kettlebell Pullover | `kettlebell-pullover` | Kettlebell + bench/floor | Side | Lying down, bell over chest → lower back behind the head in an arc → return. |
| 86 | Kettlebell Curl | `kettlebell-curl` | Kettlebell | Side | Bell hanging by the handle → curl up → lower. |
| 87 | Kettlebell Overhead Triceps Extension | `kettlebell-overhead-triceps-extension` | Kettlebell | Side | Bell held overhead by the horns → lower behind the head → extend. |
| 88 | Turkish Get-Up | `turkish-get-up` | Kettlebell | Side or 3/4 | Lying with the bell pressed up in one hand → roll to elbow, to hand, sweep leg under, kneel, stand, keeping the bell overhead → reverse. (Show the key positions; a few seconds is fine.) |
| 89 | Kettlebell Windmill | `kettlebell-windmill` | Kettlebell | Front | Bell locked overhead in one hand → hinge sideways, other hand slides down the leg toward the floor, eyes on the bell → return. |
| 90 | Towel Row | `towel-row` | Towel + door/post | Side | Holding a towel looped around a sturdy post, leaning back → pull body toward it → lower back. |
| 91 | Wall Angel | `wall-angel` | Wall | Front | Back against a wall, arms in a goal-post shape touching the wall → slide arms up overhead → slide back down. |
| 92 | Bird Dog | `bird-dog` | None | Side | On hands and knees → extend opposite arm and leg straight out → return, switch sides. |
| 93 | Hanging Knee Raise | `hanging-knee-raise` | Pull-up bar | Side | Hanging from a bar → raise knees toward the chest → lower. |
| 94 | Reverse Curl | `reverse-curl` | Barbell or dumbbells | Side | Palms facing down → curl up → lower. |
| 95 | Preacher Curl | `preacher-curl` | Preacher bench + bar/dumbbell | Side | Upper arms on the pad, arms straight → curl up → lower. |
| 96 | Concentration Curl | `concentration-curl` | Dumbbell, seated | Side or 3/4 | Seated, elbow braced on the inner thigh → curl up → lower. |
| 97 | Skull Crusher | `skull-crusher` | EZ bar/dumbbells + bench | Side | Lying on bench, arms straight up → bend elbows to lower weight toward the forehead → extend. |
| 98 | Lateral Raise | `lateral-raise` | Dumbbells | Front | Dumbbells at sides → raise arms out to the sides to shoulder height, slight elbow bend → lower. |
| 99 | Cable Lateral Raise | `cable-lateral-raise` | Cable machine, one handle | Front | Standing side-on to a low cable, handle in far hand → raise arm out to shoulder height → lower. |
| 100 | Front Raise | `front-raise` | Dumbbells | Side | Dumbbells in front of thighs → raise straight arms forward to shoulder height → lower. |
| 101 | Rear Delt Raise | `rear-delt-raise` | Dumbbells | Side or 3/4 | Bent over, back flat, dumbbells hanging → raise arms out to the sides → lower. |
| 102 | Upright Row | `upright-row` | Barbell or dumbbells | Front | Weight in front of thighs → pull straight up to chest height, elbows high → lower. |
| 103 | Wrist Curl | `wrist-curl` | Dumbbells or barbell | Side | Forearms on thighs, wrists over the knees → curl the wrists up → lower. |
| 104 | Dead Hang | `dead-hang` | Pull-up bar | Side or front | Hanging from a bar with straight arms. A hold: a still image is fine. |
| 105 | Ab Wheel Rollout | `ab-wheel-rollout` | Ab wheel | Side | Kneeling, hands on the wheel under the shoulders → roll forward as far as you can control → roll back. |

## Part B: Core, mobility & stretching (26)

| # | Exercise | File name (add the extension) | Equipment | View | What to show (start → end) |
|---|---|---|---|---|---|
| 106 | Hollow Body Hold | `hollow-body-hold` | None | Side | On back, lower back pressed down, arms overhead and legs straight, both a few inches off the floor. A hold. |
| 107 | Mountain Climber | `mountain-climber` | None | Side | High plank → drive one knee toward the chest, then switch legs quickly, like running in place. |
| 108 | Cat-Cow | `cat-cow` | None | Side | On hands and knees → round the back up (cat) → let the belly drop and lift the chest (cow). |
| 109 | Thoracic Rotation | `thoracic-rotation` | None | Front or 3/4 | On hands and knees, one hand behind the head → rotate that elbow down, then up toward the ceiling. |
| 110 | World's Greatest Stretch | `worlds-greatest-stretch` | None | Side or 3/4 | Deep lunge, hand inside the front foot → rotate and reach the other arm to the ceiling → return. |
| 111 | Hip Flexor Stretch | `hip-flexor-stretch` | None | Side | Half-kneeling, one knee down → shift hips forward until you feel the stretch at the front of the back hip. A hold. |
| 112 | Reverse Crunch | `reverse-crunch` | None | Side | On back, knees bent up at 90° → curl hips off the floor bringing knees to chest → lower. |
| 113 | Russian Twist | `russian-twist` | None (optional weight) | Front or 3/4 | Seated, leaning back, feet up or down → rotate torso side to side, hands together. |
| 114 | Clamshell | `clamshell` | Optional band around the knees | Front | Lying on your side, knees bent, feet together → open the top knee up → close. |
| 115 | Side-Lying Leg Raise | `side-lying-leg-raise` | None | Front | Lying on your side, legs straight → raise the top leg → lower. |
| 116 | Monster Walk | `monster-walk` | Band around knees or ankles | Front | Half-squat with a band around the legs → step forward diagonally, alternating feet. |
| 117 | Lateral Band Walk | `lateral-band-walk` | Band around knees or ankles | Front | Half-squat with a band → step sideways, keeping tension on the band. |
| 118 | Thread the Needle | `thread-the-needle` | None | Side or 3/4 | On hands and knees → slide one arm under the body, shoulder toward the floor → return and reach up. |
| 119 | Pigeon Stretch | `pigeon-stretch` | None | Side or 3/4 | Front leg folded across in front, back leg straight behind → fold forward over the front leg. A hold. |
| 120 | Arm Circles | `arm-circles` | None | Front | Arms straight out to the sides → small circles growing larger. |
| 121 | Child's Pose | `childs-pose` | None | Side | Kneeling, sit back on the heels, arms stretched forward on the floor. A hold. |
| 122 | Seated Forward Fold | `seated-forward-fold` | None | Side | Seated, legs straight → reach forward toward the toes. A hold. |
| 123 | Hamstring Stretch | `hamstring-stretch` | None | Side | Lying on back or standing with a heel up → straight leg raised/stretched. A hold. |
| 124 | Standing Quad Stretch | `standing-quad-stretch` | None | Side | Standing on one leg, holding the other foot behind toward the glute. A hold. |
| 125 | Deep Breathing | `deep-breathing` | None | — | OPTIONAL — breathing, no movement. A calm seated figure or skip. |
| 126 | Box Breathing | `box-breathing` | None | — | OPTIONAL — breathing, no movement. A calm seated figure or skip. |
| 127 | Foam Roll Quads | `foam-roll-quads` | Foam roller | Side | Face down on forearms, roller under the thighs → roll from hip to just above the knee and back. |
| 128 | Foam Roll Hamstrings | `foam-roll-hamstrings` | Foam roller | Side | Seated with the roller under the back of the thighs, hands behind → roll from knee to hip and back. |
| 129 | Foam Roll Back | `foam-roll-back` | Foam roller | Side | Lying back on the roller under the upper back, hips up → roll the upper back. |
| 130 | Foam Roll Lats | `foam-roll-lats` | Foam roller | Front or 3/4 | Lying on your side, roller under the armpit area, arm overhead → roll along the side of the back. |
| 131 | Standing Forward Fold | `standing-forward-fold` | None | Side | Standing → fold forward from the hips, reaching toward the floor, knees soft. A hold. |
