'use strict';

/* =========================================================
 * 운동 카탈로그
 * 형식: "부위|운동 이름|영문 이름|검색용 별칭(쉼표 구분)"
 * ========================================================= */

const EXERCISE_PARTS = ['가슴', '등', '어깨', '하체', '이두', '삼두', '전완', '복근', '전신', '유산소', '스포츠'];

const EXERCISE_DATA = `
가슴|바벨 벤치프레스|Barbell Bench Press|벤치,벤치프레스,플랫벤치
가슴|덤벨 벤치프레스|Dumbbell Bench Press|덤벨프레스,덤벨벤치
가슴|인클라인 바벨 벤치프레스|Incline Barbell Bench Press|인클라인벤치,인클라인프레스
가슴|인클라인 덤벨 프레스|Incline Dumbbell Press|인클덤벨,인클라인덤벨
가슴|디클라인 바벨 벤치프레스|Decline Barbell Bench Press|디클라인벤치
가슴|디클라인 덤벨 프레스|Decline Dumbbell Press|디클라인덤벨
가슴|스미스머신 벤치프레스|Smith Machine Bench Press|스미스벤치
가슴|스미스머신 인클라인 프레스|Smith Machine Incline Press|스미스인클라인
가슴|체스트 프레스 머신|Chest Press Machine|체프,머신프레스,체스트프레스
가슴|인클라인 체스트 프레스 머신|Incline Chest Press Machine|인클라인머신
가슴|해머 스트렝스 체스트 프레스|Hammer Strength Chest Press|해머벤치
가슴|덤벨 플라이|Dumbbell Fly|플라이,덤벨플라이
가슴|인클라인 덤벨 플라이|Incline Dumbbell Fly|인클라인플라이
가슴|펙덱 플라이|Pec Deck Fly|펙덱,버터플라이,체스트플라이
가슴|케이블 크로스오버|Cable Crossover|크로스오버,케이블플라이
가슴|로우 케이블 플라이|Low Cable Fly|로우투하이
가슴|하이 케이블 플라이|High Cable Fly|하이투로우
가슴|푸시업|Push-up|팔굽혀펴기,푸쉬업
가슴|인클라인 푸시업|Incline Push-up|인클라인푸쉬업
가슴|디클라인 푸시업|Decline Push-up|디클라인푸쉬업
가슴|중량 푸시업|Weighted Push-up|
가슴|체스트 딥스|Chest Dips|딥스,평행봉
가슴|중량 딥스|Weighted Dips|
가슴|어시스트 딥스|Assisted Dips|어시스티드딥스
가슴|덤벨 풀오버|Dumbbell Pullover|풀오버
가슴|스베드 프레스|Svend Press|
가슴|랜드마인 프레스|Landmine Press|
가슴|플로어 프레스|Floor Press|
가슴|클로즈그립 덤벨 프레스|Squeeze Press|스퀴즈프레스
등|데드리프트|Deadlift|데드,컨벤셔널데드리프트
등|스모 데드리프트|Sumo Deadlift|스모데드
등|랙 풀|Rack Pull|랙풀
등|풀업|Pull-up|턱걸이,풀업
등|친업|Chin-up|친업,언더그립턱걸이
등|중량 풀업|Weighted Pull-up|중량턱걸이
등|어시스트 풀업 머신|Assisted Pull-up Machine|어시스트풀업,어시스티드
등|랫풀다운|Lat Pulldown|랫풀,렛풀다운
등|와이드그립 랫풀다운|Wide Grip Lat Pulldown|와이드랫풀
등|클로즈그립 랫풀다운|Close Grip Lat Pulldown|브이바랫풀,클로즈랫풀
등|언더그립 랫풀다운|Reverse Grip Lat Pulldown|리버스랫풀
등|싱글암 랫풀다운|Single Arm Lat Pulldown|원암랫풀
등|바벨 로우|Barbell Row|바벨로우,벤트오버로우
등|펜들레이 로우|Pendlay Row|
등|언더그립 바벨 로우|Reverse Grip Barbell Row|언더그립로우,예이츠로우
등|덤벨 로우|Dumbbell Row|원암덤벨로우,원암로우
등|체스트 서포티드 덤벨 로우|Chest Supported Dumbbell Row|인클라인덤벨로우
등|티바 로우|T-Bar Row|티바로우,T바로우
등|시티드 케이블 로우|Seated Cable Row|케이블로우,시티드로우
등|싱글암 케이블 로우|Single Arm Cable Row|원암케이블로우
등|시티드 로우 머신|Seated Row Machine|로우머신
등|해머 스트렝스 로우|Hammer Strength Row|해머로우
등|하이 로우 머신|High Row Machine|하이로우
등|로우 로우 머신|Low Row Machine|로우로우
등|스트레이트 암 풀다운|Straight Arm Pulldown|암풀다운,스트레이트암
등|케이블 풀오버|Cable Pullover|
등|인버티드 로우|Inverted Row|오스트레일리안풀업
등|메도우스 로우|Meadows Row|
등|씰 로우|Seal Row|
등|백 익스텐션|Back Extension|백익스텐션,하이퍼익스텐션
등|굿모닝|Good Morning|굿모닝
등|바벨 슈러그|Barbell Shrug|슈러그
등|덤벨 슈러그|Dumbbell Shrug|
등|스미스머신 슈러그|Smith Machine Shrug|
어깨|오버헤드 프레스|Overhead Press|OHP,밀리터리프레스,스탠딩프레스
어깨|시티드 바벨 숄더 프레스|Seated Barbell Shoulder Press|바벨숄더프레스
어깨|덤벨 숄더 프레스|Dumbbell Shoulder Press|덤벨숄프,숄더프레스
어깨|아놀드 프레스|Arnold Press|
어깨|숄더 프레스 머신|Shoulder Press Machine|머신숄더프레스
어깨|스미스머신 숄더 프레스|Smith Machine Shoulder Press|스미스숄더
어깨|비하인드 넥 프레스|Behind the Neck Press|비하인드넥
어깨|푸시 프레스|Push Press|
어깨|사이드 레터럴 레이즈|Side Lateral Raise|사레레,사이드레이즈,레터럴레이즈
어깨|케이블 레터럴 레이즈|Cable Lateral Raise|케이블사레레
어깨|머신 레터럴 레이즈|Machine Lateral Raise|머신사레레
어깨|린 어웨이 레터럴 레이즈|Lean Away Lateral Raise|
어깨|프론트 레이즈|Front Raise|프레이즈,전면레이즈
어깨|바벨 프론트 레이즈|Barbell Front Raise|
어깨|플레이트 프론트 레이즈|Plate Front Raise|
어깨|케이블 프론트 레이즈|Cable Front Raise|
어깨|벤트오버 레터럴 레이즈|Bent Over Lateral Raise|벤트오버레이즈,후면레이즈
어깨|리어 델트 플라이 머신|Rear Delt Fly Machine|리버스펙덱,리어델트
어깨|케이블 리어 델트 플라이|Cable Rear Delt Fly|
어깨|페이스 풀|Face Pull|페이스풀
어깨|업라이트 로우|Upright Row|업라이트로우
어깨|케이블 업라이트 로우|Cable Upright Row|
어깨|Y 레이즈|Y Raise|와이레이즈
어깨|랜드마인 숄더 프레스|Landmine Shoulder Press|
어깨|핸드스탠드 푸시업|Handstand Push-up|물구나무
어깨|파이크 푸시업|Pike Push-up|
하체|바벨 백 스쿼트|Barbell Back Squat|스쿼트,백스쿼트
하체|프론트 스쿼트|Front Squat|
하체|하이바 스쿼트|High Bar Squat|
하체|로우바 스쿼트|Low Bar Squat|
하체|박스 스쿼트|Box Squat|
하체|포즈 스쿼트|Pause Squat|
하체|고블릿 스쿼트|Goblet Squat|고블렛스쿼트
하체|스미스머신 스쿼트|Smith Machine Squat|스미스스쿼트
하체|핵 스쿼트|Hack Squat|핵스쿼트
하체|V 스쿼트 머신|V Squat Machine|브이스쿼트
하체|펜듈럼 스쿼트|Pendulum Squat|
하체|벨트 스쿼트|Belt Squat|
하체|맨몸 스쿼트|Bodyweight Squat|에어스쿼트
하체|점프 스쿼트|Jump Squat|
하체|피스톨 스쿼트|Pistol Squat|
하체|레그 프레스|Leg Press|레그프레스
하체|45도 레그 프레스|45 Degree Leg Press|
하체|싱글 레그 프레스|Single Leg Press|원레그프레스
하체|레그 익스텐션|Leg Extension|레그익스텐션
하체|레그 컬|Leg Curl|레그컬
하체|라잉 레그 컬|Lying Leg Curl|라잉레그컬
하체|시티드 레그 컬|Seated Leg Curl|시티드레그컬
하체|스탠딩 레그 컬|Standing Leg Curl|
하체|노르딕 햄스트링 컬|Nordic Hamstring Curl|노르딕컬
하체|루마니안 데드리프트|Romanian Deadlift|RDL,루마니안
하체|덤벨 루마니안 데드리프트|Dumbbell Romanian Deadlift|덤벨RDL
하체|스티프 레그 데드리프트|Stiff Leg Deadlift|SLDL,스티프
하체|싱글 레그 루마니안 데드리프트|Single Leg RDL|원레그RDL
하체|트랩바 데드리프트|Trap Bar Deadlift|헥스바데드
하체|바벨 런지|Barbell Lunge|런지
하체|덤벨 런지|Dumbbell Lunge|
하체|워킹 런지|Walking Lunge|
하체|리버스 런지|Reverse Lunge|
하체|사이드 런지|Side Lunge|
하체|불가리안 스플릿 스쿼트|Bulgarian Split Squat|불가리안,BSS
하체|스플릿 스쿼트|Split Squat|
하체|스텝업|Step-up|스텝업
하체|힙 쓰러스트|Hip Thrust|힙쓰러스트,바벨힙쓰러스트
하체|힙 쓰러스트 머신|Hip Thrust Machine|
하체|글루트 브릿지|Glute Bridge|브릿지
하체|케이블 킥백|Cable Kickback|힙킥백,글루트킥백
하체|글루트 킥백 머신|Glute Kickback Machine|
하체|힙 어브덕션 머신|Hip Abduction Machine|어브덕션,이너타이반대,아웃타이
하체|힙 어덕션 머신|Hip Adduction Machine|어덕션,이너타이
하체|케이블 힙 어브덕션|Cable Hip Abduction|
하체|스탠딩 카프 레이즈|Standing Calf Raise|카프레이즈,종아리
하체|시티드 카프 레이즈|Seated Calf Raise|
하체|레그프레스 카프 레이즈|Leg Press Calf Raise|
하체|스미스머신 카프 레이즈|Smith Machine Calf Raise|
하체|덩키 카프 레이즈|Donkey Calf Raise|
하체|시시 스쿼트|Sissy Squat|
하체|월 싯|Wall Sit|벽스쿼트
이두|바벨 컬|Barbell Curl|바벨컬
이두|EZ바 컬|EZ Bar Curl|이지바컬
이두|덤벨 컬|Dumbbell Curl|덤벨컬
이두|얼터네이트 덤벨 컬|Alternate Dumbbell Curl|얼터네이트컬
이두|해머 컬|Hammer Curl|해머컬
이두|케이블 해머 컬|Cable Hammer Curl|로프해머컬
이두|인클라인 덤벨 컬|Incline Dumbbell Curl|인클라인컬
이두|프리처 컬|Preacher Curl|프리쳐컬
이두|머신 프리처 컬|Machine Preacher Curl|
이두|컨센트레이션 컬|Concentration Curl|
이두|케이블 컬|Cable Curl|
이두|베이시안 케이블 컬|Bayesian Cable Curl|베이지안컬
이두|스파이더 컬|Spider Curl|
이두|드래그 컬|Drag Curl|
이두|21s 컬|21s Curl|21컬
이두|리버스 컬|Reverse Curl|리버스바벨컬
이두|조트맨 컬|Zottman Curl|
이두|암 컬 머신|Arm Curl Machine|머신컬
삼두|라잉 트라이셉스 익스텐션|Lying Triceps Extension|스컬크러셔,라잉익스텐션
삼두|덤벨 라잉 트라이셉스 익스텐션|Dumbbell Lying Triceps Extension|
삼두|오버헤드 트라이셉스 익스텐션|Overhead Triceps Extension|오버헤드익스텐션
삼두|덤벨 오버헤드 익스텐션|Dumbbell Overhead Extension|
삼두|케이블 오버헤드 익스텐션|Cable Overhead Extension|
삼두|트라이셉스 푸시다운|Triceps Pushdown|푸시다운,푸쉬다운,케이블푸시다운
삼두|로프 푸시다운|Rope Pushdown|로프푸쉬다운
삼두|리버스그립 푸시다운|Reverse Grip Pushdown|
삼두|싱글암 케이블 푸시다운|Single Arm Pushdown|
삼두|클로즈그립 벤치프레스|Close Grip Bench Press|클로즈벤치,내로우벤치
삼두|덤벨 킥백|Dumbbell Kickback|킥백,트라이셉스킥백
삼두|케이블 킥백|Cable Triceps Kickback|
삼두|벤치 딥스|Bench Dips|
삼두|트라이셉스 딥스|Triceps Dips|삼두딥스
삼두|다이아몬드 푸시업|Diamond Push-up|다이아몬드푸쉬업
삼두|JM 프레스|JM Press|
삼두|트라이셉스 익스텐션 머신|Triceps Extension Machine|
삼두|딥스 머신|Dip Machine|
전완|리스트 컬|Wrist Curl|손목컬
전완|리버스 리스트 컬|Reverse Wrist Curl|
전완|파머스 워크|Farmer's Walk|파머스캐리,농부걷기
전완|데드 행|Dead Hang|매달리기
전완|플레이트 핀치|Plate Pinch|
전완|그립 트레이너|Grip Trainer|악력기
복근|크런치|Crunch|크런치
복근|리버스 크런치|Reverse Crunch|
복근|바이시클 크런치|Bicycle Crunch|자전거크런치
복근|케이블 크런치|Cable Crunch|
복근|크런치 머신|Crunch Machine|복근머신
복근|싯업|Sit-up|윗몸일으키기
복근|디클라인 싯업|Decline Sit-up|
복근|레그 레이즈|Leg Raise|레그레이즈,누워서다리들기
복근|행잉 레그 레이즈|Hanging Leg Raise|행잉레그레이즈
복근|행잉 니 레이즈|Hanging Knee Raise|
복근|캡틴스 체어 레그 레이즈|Captain's Chair Leg Raise|
복근|토즈 투 바|Toes to Bar|T2B
복근|플랭크|Plank|플랭크
복근|사이드 플랭크|Side Plank|
복근|러시안 트위스트|Russian Twist|
복근|AB 롤아웃|Ab Wheel Rollout|복근롤러,ab슬라이드,롤아웃
복근|마운틴 클라이머|Mountain Climber|
복근|데드버그|Dead Bug|
복근|할로우 바디 홀드|Hollow Body Hold|
복근|V 업|V-up|브이업
복근|우드찹|Woodchopper|케이블우드찹
복근|팔로프 프레스|Pallof Press|
복근|드래곤 플래그|Dragon Flag|
복근|사이드 벤드|Side Bend|덤벨사이드벤드
전신|클린|Clean|파워클린
전신|파워 클린|Power Clean|
전신|행 클린|Hang Clean|
전신|클린 앤 저크|Clean and Jerk|용상
전신|스내치|Snatch|인상
전신|스러스터|Thruster|
전신|케틀벨 스윙|Kettlebell Swing|케틀벨
전신|케틀벨 고블릿 스쿼트|Kettlebell Goblet Squat|
전신|터키시 겟업|Turkish Get-up|
전신|버피|Burpee|버피테스트
전신|맨 메이커|Man Maker|
전신|슬레드 푸시|Sled Push|썰매
전신|배틀 로프|Battle Rope|배틀로프
전신|월볼|Wall Ball|
전신|박스 점프|Box Jump|
전신|메디신볼 슬램|Medicine Ball Slam|볼슬램
전신|자위행위|Self Care|딸,딸딸이,자위,ㅈㅇ
유산소|트레드밀|Treadmill|러닝머신,런닝머신,걷기
유산소|인클라인 워킹|Incline Walking|경사걷기
유산소|러닝|Running|달리기,조깅
유산소|실내 사이클|Stationary Bike|자전거,사이클
유산소|스핀 바이크|Spin Bike|스피닝
유산소|일립티컬|Elliptical|크로스트레이너
유산소|천국의 계단|Stair Climber|스텝밀,계단오르기
유산소|로잉 머신|Rowing Machine|로잉,조정
유산소|줄넘기|Jump Rope|
유산소|수영|Swimming|
유산소|크로스핏|CrossFit WOD|크핏,와드,WOD,crossfit
유산소|하이록스|HYROX|하록,hyrox,하이록
스포츠|스크린골프|Screen Golf|스크골,스크린 골프,screengolf
유산소|에어 바이크|Air Bike|어썰트바이크
유산소|스키 에르그|Ski Erg|
유산소|등산|Hiking|하이킹
유산소|걷기|Walking|산책,워킹
유산소|인터벌 러닝|Interval Running|인터벌,HIIT러닝
유산소|야외 자전거|Cycling|라이딩,로드바이크
스포츠|풋살|Futsal|풋살
스포츠|축구|Soccer|
스포츠|농구|Basketball|
스포츠|배드민턴|Badminton|
스포츠|테니스|Tennis|
스포츠|탁구|Table Tennis|
스포츠|클라이밍|Climbing|암벽,볼더링
스포츠|복싱|Boxing|권투,스파링
스포츠|주짓수|Jiu-Jitsu|
스포츠|스쿼시|Squash|
스포츠|필드골프|Field Golf|골프,라운딩,필드,golf
스포츠|요가|Yoga|
스포츠|필라테스|Pilates|
`;

const EXERCISES = EXERCISE_DATA.trim().split('\n').map((line) => {
  const [part, name, en, alias] = line.split('|');
  return { part, name, en, alias: alias ? alias.split(',').filter(Boolean) : [] };
});

/* ---------- 검색 (초성 / 영문 / 별칭 / 띄어쓰기 무시) ---------- */
const CHOSUNG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

function toChosung(str) {
  let out = '';
  for (const ch of str) {
    const code = ch.charCodeAt(0) - 0xac00;
    out += code >= 0 && code <= 11171 ? CHOSUNG[Math.floor(code / 588)] : ch;
  }
  return out;
}
function normalize(str) {
  return String(str).toLowerCase().replace(/[\s\-_'·]/g, '');
}
function isChosungOnly(str) {
  return /^[ㄱ-ㅎ]+$/.test(str);
}

/** 검색어와 운동의 일치 점수 (0 = 불일치, 높을수록 우선) */
function matchScore(ex, query) {
  const q = normalize(query);
  if (!q) return 1;
  const name = normalize(ex.name);
  const fields = [name, normalize(ex.en || ''), ...ex.alias.map(normalize)];
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (fields.some((f) => f === q)) return 90;
  if (name.includes(q)) return 60;
  if (fields.some((f) => f.includes(q))) return 50;
  if (isChosungOnly(q)) {
    const cs = [name, ...ex.alias.map(normalize)].map(toChosung);
    if (cs[0].startsWith(q)) return 45;
    if (cs.some((c) => c.includes(q))) return 40;
  }
  return 0;
}

/* ---------- 맨몸 운동 ----------
 * bw     : 볼륨 = (몸무게 + 추가 중량) × 횟수
 * assist : 볼륨 = (몸무게 − 보조 중량) × 횟수
 * 플랭크·월싯·데드행처럼 시간으로 하는 운동은 제외 */
const BODYWEIGHT_TYPE = {};
`푸시업,인클라인 푸시업,디클라인 푸시업,중량 푸시업,체스트 딥스,중량 딥스,
풀업,친업,중량 풀업,인버티드 로우,백 익스텐션,
핸드스탠드 푸시업,파이크 푸시업,
맨몸 스쿼트,점프 스쿼트,피스톨 스쿼트,노르딕 햄스트링 컬,시시 스쿼트,
벤치 딥스,트라이셉스 딥스,다이아몬드 푸시업,
크런치,리버스 크런치,바이시클 크런치,싯업,디클라인 싯업,레그 레이즈,행잉 레그 레이즈,행잉 니 레이즈,
캡틴스 체어 레그 레이즈,토즈 투 바,러시안 트위스트,AB 롤아웃,마운틴 클라이머,V 업,드래곤 플래그,데드버그,
버피,박스 점프`.split(',').forEach((n) => { BODYWEIGHT_TYPE[n.trim()] = 'bw'; });
['어시스트 딥스', '어시스트 풀업 머신'].forEach((n) => { BODYWEIGHT_TYPE[n] = 'assist'; });
/** 맨몸 운동 볼륨 너프 배율 (없으면 1) — 맨몸 풀업은 70% */
const BW_SCALE = { '풀업': 0.7 };
EXERCISES.forEach((e) => { e.bw = BODYWEIGHT_TYPE[e.name] || null; });

/* ---------- 유산소 / 스포츠 환산 기준 ----------
 * 기록: 거리(km) + 시간(분)
 * 1) 거리 기준(perKm 있음, 거리 입력 시): 소모 kcal ≈ perKm × 몸무게 × km
 *    (달리기는 속도와 상관없이 약 1kcal/kg/km 소모 — 운동생리학 일반식)
 * 2) 시간 기준(그 외):            소모 kcal ≈ (MET − 1) × 몸무게 × 시간(h)
 *    (MET: 2024 Compendium of Physical Activities 기준, 쉬는 상태 1MET는 뺀 순수 운동량)
 * kcalOnly: 칼로리 입력 방식만 사용 (수영 · 크로스핏)
 * timeScale: 시간 기준 계산일 때만 보정 (풋살 0.7)
 * scale: 그룹 합의 보정 — 근력 볼륨과 체감 난이도를 맞춤 (러닝류 70%, 풋살 50%)
 * 환산 볼륨 = 소모 kcal × 25
 *    (근력운동 1시간 ≈ 볼륨 1만kg ≈ 350kcal → 1kcal ≈ 25kg 으로 맞춤)
 */
const CARDIO_KCAL_TO_VOLUME = 25;
/** 유산소·스포츠 전체 볼륨 너프 (50%) */
const CARDIO_NERF = 0.5;
/* 🏃 페이스 보너스 (거리+시간 둘 다 적었을 때)
 * 러닝: 6'00"/km(10km/h) = ×1.00, 1km/h 빠를 때마다 +8% (최대 ×1.4, 최소 ×0.85)
 *       → 5'00"/km ×1.16 · 4'30"/km ×1.27 · 4'00"/km ×1.40
 * 걷기: 5km/h = ×1.00, 1km/h 빠를 때마다 +10% (최대 ×1.4, 최소 ×0.8) */
const PACE_BONUS = { run: { base: 10, step: 0.08, lo: 0.85, hi: 1.4 }, walk: { base: 5, step: 0.1, lo: 0.8, hi: 1.4 } };
function paceFactor(info, km, min) {
  const b = info && PACE_BONUS[info.pace];
  if (!b || !(km > 0) || !(min > 0)) return 1;
  const speed = km / (min / 60);
  if (speed > (info.pace === 'run' ? 25 : 12)) return 1;   // 잘못 입력한 값은 보너스 없음
  return Math.min(b.hi, Math.max(b.lo, 1 + (speed - b.base) * b.step));
}
const CARDIO = {
  '러닝': { met: 9.8, perKm: 1.0, scale: 0.7, pace: 'run' },
  '트레드밀': { met: 9.0, perKm: 1.0, scale: 0.7, pace: 'run' },
  '인터벌 러닝': { met: 11.0, perKm: 1.05, scale: 0.7, pace: 'run' },
  '걷기': { met: 3.5, perKm: 0.5, pace: 'walk' },
  '인클라인 워킹': { met: 6.0, perKm: 0.8 },
  '등산': { met: 6.5, perKm: 0.9 },
  '실내 사이클': { met: 7.0, perKm: 0.3 },
  '야외 자전거': { met: 7.5, perKm: 0.3 },
  '스핀 바이크': { met: 8.5, perKm: 0.3 },
  '에어 바이크': { met: 10.0 },
  '일립티컬': { met: 5.0 },
  '천국의 계단': { met: 9.0 },
  '로잉 머신': { met: 7.0, perKm: 0.8 },
  '스키 에르그': { met: 8.0 },
  '줄넘기': { met: 11.0 },
  '수영': { met: 7.0, kcalOnly: true },   // 칼로리 입력만 (워치 칼로리 × 25)
  '크로스핏': { met: 8.0, kcalOnly: true, scale: 0.7 }, // 칼로리 입력만 · 30% 할인
  '하이록스': { met: 9.0, scale: 0.7, hyrox: true }, // 완주 시간만 적으면 자동 계산 (워치 칼로리도 가능) · 30% 할인
  '풋살': { met: 8.0, perKm: 1.0, timeScale: 0.7, scale: 0.5, goals: true },   // 시간만 입력 시 30% 낮춤, 전체 50%
  '축구': { met: 7.0, perKm: 1.0, goals: true },
  '농구': { met: 6.5 },
  '배드민턴': { met: 5.5 },
  '테니스': { met: 7.3 },
  '탁구': { met: 4.0 },
  '클라이밍': { met: 8.0 },
  '복싱': { met: 7.8 },
  '주짓수': { met: 7.8 },
  '스쿼시': { met: 7.3 },
  '골프': { met: 3.5 },
  '요가': { met: 2.5 },
  '필라테스': { met: 3.0 },
};
EXERCISES.forEach((e) => { e.cardio = CARDIO[e.name] || null; });

/* 🏁 하이록스 공식 코스: 1km 달리기 + 스테이션, 8번 반복 (총 러닝 8km) */
const HYROX_STATIONS = ['스키에르그 1000m', '슬레드 푸시 50m', '슬레드 풀 50m', '버피 브로드 점프 80m', '로잉 1000m', '파머스 캐리 200m', '샌드백 런지 100m', '월볼 100개'];

/* ---------- 덤벨 운동 (무게 입력 주의 표시) ---------- */
const DUMBBELL_EXTRA = ['사이드 레터럴 레이즈', '린 어웨이 레터럴 레이즈', '프론트 레이즈', '벤트오버 레터럴 레이즈', '아놀드 프레스',
  'Y 레이즈', '해머 컬', '컨센트레이션 컬', '스파이더 컬', '조트맨 컬', '고블릿 스쿼트', '불가리안 스플릿 스쿼트', '스플릿 스쿼트',
  '스텝업', '워킹 런지', '리버스 런지', '사이드 런지', '파머스 워크', '사이드 벤드', '리스트 컬', '리버스 리스트 컬',
  '싱글 레그 루마니안 데드리프트', '스베드 프레스'];
function isDumbbellExercise(name) {
  return /덤벨/.test(name || '') || DUMBBELL_EXTRA.includes(name);
}

/* ⛳ 골프: 1타 = 10kg 볼륨, 타수가 적을수록 잘 친 것
 * 필드골프는 18홀 기준 걷기 6km를 더함 (홀 수에 비례) */
const GOLF_KG_PER_STROKE = 10;
const FIELD_GOLF_KM = 6;
function isGolf(ex) { return !!ex && (ex.name === '스크린골프' || ex.name === '필드골프'); }
function isFieldGolf(ex) { return !!ex && ex.name === '필드골프'; }

/* 🫣 벌칙 운동: 횟수를 적은 세트마다 볼륨 −50kg */
const PENALTY_KG = { '자위행위': -50 };
function isPenalty(ex) { return !!ex && PENALTY_KG[ex.name] !== undefined; }
