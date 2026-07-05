// ============================================================
// utils/kb.js
// 宠物皮肤病知识库 + 检索函数（RAG）
// 纯本地 JS，无后端无数据库，检索 < 1ms
// 当前收录：66 种疾病（含细分补充条目）
// ============================================================

/**
 * 知识库条目结构：
 *   name          疾病中文名
 *   aliases       别名（含英文，用于关键词匹配）
 *   species       适用物种 ['犬'] / ['猫'] / ['犬','猫']
 *   keywords      检索关键词 { breeds, locations, symptoms }
 *   typicalFeatures  典型临床表现（注入 prompt 帮助 AI 对照图片）
 *   ddx           鉴别诊断要点（注入 prompt 帮助 AI 区分相似病）
 *   urgency       默认紧急度参考
 */
var DISEASE_KB = [

  // ── 犬常见 ──

  {
    name: '急性湿性皮炎（热点）',
    category: 'bacterial',
    aliases: ['热点', '湿性皮炎', '急性湿疹', 'hot spot', 'acute moist dermatitis'],
    species: ['犬'],
    keywords: {
      breeds: ['金毛', '拉布拉多', '德牧', '柯基', '边牧', '金毛寻回犬'],
      locations: ['背部', '腰部', '臀部', '颈部', '面部', '颊'],
      symptoms: ['红肿', '渗出', '脱毛', '舔舐', '突然', '急性', '潮湿', '糜烂', '湿润', '搔抓']
    },
    typicalFeatures: '边界不清的红肿脱毛区，表面浆液性渗出，周围毛发潮湿粘连，急性发作（24-48h内）',
    ddx: '与浅表脓皮病区分：热点为大面积急性渗出性糜烂，脓皮病多为丘疹脓疱散在分布',
    urgency: 'moderate'
  },

  {
    name: '特应性皮炎（环境过敏）',
    aliases: ['特应性皮炎', '过敏性皮炎', '异位性皮炎', 'atopic dermatitis'],
    species: ['犬', '猫'],
    keywords: {
      breeds: ['金毛', '拉布拉多', '柴犬', '法斗', '英斗', '比熊', '边牧', '德牧'],
      locations: ['爪部', '腹部', '腋下', '腹股沟', '面部', '耳部', '眼周'],
      symptoms: ['瘙痒', '舔舐', '红肿', '反复', '季节性', '慢性', '舔爪', '挠', '摩擦']
    },
    typicalFeatures: '1-3岁发病，肢体末端及腹侧瘙痒性红斑，慢性反复发作，季节性加重',
    ddx: '与食物过敏区分：特应性皮炎通常环境相关、季节性，食物过敏全年性且可能伴胃肠症状',
    urgency: 'low',
    relatedDiseases: [
      { name: '浅表脓皮病', relation: '继发', desc: '特应性皮炎常继发细菌感染' },
      { name: '马拉色菌皮炎', relation: '继发', desc: '过敏导致皮肤屏障受损易继发酵母菌' },
      { name: '跳蚤过敏性皮炎', relation: '鉴别', desc: '两者均为瘙痒性皮肤病，需排除跳蚤后再考虑环境过敏' }
    ]
  },

  {
    name: '跳蚤过敏性皮炎',
    aliases: ['跳蚤过敏', '跳蚤', 'flea allergy'],
    species: ['犬', '猫'],
    keywords: {
      breeds: ['犬不分品种', '猫不分品种'],
      locations: ['腰部', '背部', '尾根', '后躯', '腹股沟', '头颈', '颈部'],
      symptoms: ['瘙痒', '剧烈瘙痒', '脱毛', '抓挠', '跳蚤', '黑色颗粒', '虫', '粟粒']
    },
    typicalFeatures: '犬：尾根至腰背剧烈瘙痒、脱毛；猫：头颈背部粟粒性结痂皮炎。体表可见黑色跳蚤粪便',
    ddx: '看不到跳蚤不能排除，跳蚤过敏性瘙痒部位（尾根/腰背）是关键鉴别点',
    urgency: 'low'
  },

  {
    name: '食物过敏性皮炎',
    aliases: ['食物过敏', '饮食过敏', 'food allergy'],
    species: ['犬', '猫'],
    keywords: {
      breeds: ['法斗', '英斗', '柴犬', '比熊'],
      locations: ['爪部', '耳部', '面部', '腹部', '肛周'],
      symptoms: ['瘙痒', '反复', '慢性', '耳炎', '胃肠', '腹泻', '呕吐', '全年']
    },
    typicalFeatures: '全年性瘙痒，常伴复发性外耳炎和/或胃肠症状，更换蛋白源后改善',
    ddx: '与特应性皮炎区分：食物过敏全年无季节性，常伴消化道症状',
    urgency: 'low'
  },

  {
    name: '浅表脓皮病',
    aliases: ['脓皮病', '细菌性毛囊炎', '浅表细菌感染', 'superficial pyoderma'],
    species: ['犬'],
    keywords: {
      breeds: ['法斗', '英斗', '巴哥', '沙皮', '金毛', '拉布拉多'],
      locations: ['腹部', '腋下', '腹股沟', '颈部', '躯干'],
      symptoms: ['丘疹', '脓疱', '结痂', '脱毛', '红斑', '鳞屑', '环形', '领圈']
    },
    typicalFeatures: '丘疹→脓疱→环形表皮领圈+中央结痂+脱毛，常继发于过敏或内分泌疾病',
    ddx: '与蠕形螨区分：脓皮病通常不伴广泛脱毛和皮肤增厚，蠕形螨多为对称性脱毛',
    urgency: 'moderate',
    relatedDiseases: [
      { name: '特应性皮炎（环境过敏）', relation: '原发', desc: '过敏是浅表脓皮病最常见的潜在原因' },
      { name: '甲状腺功能减退相关皮肤改变', relation: '原发', desc: '甲减等内分泌病可导致反复脓皮病' },
      { name: '库兴综合征相关皮肤改变', relation: '原发', desc: '库兴免疫抑制可继发脓皮病' }
    ]
  },

  {
    name: '深部脓皮病',
    aliases: ['深部细菌感染', 'deep pyoderma'],
    species: ['犬'],
    keywords: {
      breeds: ['德牧', '金毛', '拉布拉多'],
      locations: ['腿部', '躯干', '背部'],
      symptoms: ['结节', '瘘管', '溃疡', '出血', '增厚', '硬化', '脓']
    },
    typicalFeatures: '深在性结节、瘘管、溃疡和出血性结痂，皮肤增厚硬化，常继发于蠕形螨或内分泌病',
    ddx: '与浅表脓皮病区分：深部脓皮病累及真皮和皮下、有结节、瘘管和出血性结痂，浅表仅丘疹脓疱和表皮领圈。与肢端舔舐性肉芽肿区分：深部脓皮病常多灶且伴瘘管流脓、多继发于蠕形螨或内分泌病；舔舐肉芽肿为肢侧面单个顽固结节、与强迫性舔舐相关。与全身型蠕形螨病区分：需刮片排除蠕形螨，它常是深部感染的诱因。',
    urgency: 'urgent',
    relatedDiseases: [
      { name: '全身型蠕形螨病', relation: '原发', desc: '蠕形螨感染是深部脓皮病常见诱因' },
      { name: '库兴综合征相关皮肤改变', relation: '原发', desc: '内分泌病免疫抑制可继发深部感染' }
    ]
  },

  {
    name: '蠕形螨病（局灶型）',
    aliases: ['蠕形螨', '局灶性蠕形螨', 'demodectic mange', 'demodicosis'],
    species: ['犬'],
    keywords: {
      breeds: ['金毛', '德牧', '法斗', '英斗', '巴哥', '沙皮', '柴犬'],
      locations: ['面部', '眼周', '前肢', '爪部'],
      symptoms: ['脱毛', '红斑', '皮屑', '不痒', '轻痒', '对称', '局灶', '幼犬']
    },
    typicalFeatures: '幼犬面部/前肢对称性脱毛、红斑、皮屑，早期不痒或轻痒，多可自愈',
    ddx: '与真菌感染区分：蠕形螨早期不痒或轻痒，真菌通常瘙痒剧烈；与脓皮病区分：蠕形螨对称性脱毛更明显',
    urgency: 'low'
  },

  {
    name: '全身型蠕形螨病',
    aliases: ['全身性蠕形螨', '泛发性蠕形螨', 'generalized demodicosis'],
    species: ['犬'],
    keywords: {
      breeds: ['金毛', '德牧', '法斗', '英斗', '巴哥', '沙皮', '柴犬', '大丹'],
      locations: ['全身', '躯干', '四肢', '面部', '爪部'],
      symptoms: ['大面积脱毛', '增厚', '蓝灰', '色素沉着', '脓疱', '瘘管', '不痒', '慢性', '继发感染']
    },
    typicalFeatures: '大面积对称脱毛、皮肤增厚呈蓝灰色、色素沉着，常继发脓皮病和瘘管，需积极治疗',
    ddx: '与局灶型蠕形螨区分：全身型累及多个体区，预后更差；与脓皮病区分：蠕形螨脱毛更广泛且对称，刮片可确诊',
    urgency: 'urgent',
    relatedDiseases: [
      { name: '深部脓皮病', relation: '继发', desc: '全身型蠕形螨常继发深部细菌感染' },
      { name: '浅表脓皮病', relation: '继发', desc: '可伴发浅表脓皮病' }
    ]
  },

  {
    name: '疥螨病',
    aliases: ['疥螨', '疥疮', 'sarcoptic mange', 'scabies'],
    species: ['犬'],
    keywords: {
      breeds: ['幼犬', '免疫低下犬', '流浪犬'],
      locations: ['耳缘', '肘部', '腹部', '胸部', '面部'],
      symptoms: ['剧烈瘙痒', '脱毛', '结痂', '增厚', '搔抓', '传染', '人也有']
    },
    typicalFeatures: '剧烈瘙痒（与蠕形螨的关键区别），耳缘、肘部、腹部脱毛结痂，人接触后也可瘙痒',
    ddx: '与蠕形螨区分：疥螨剧烈瘙痒，蠕形螨不痒或轻痒；与跳蚤过敏区分：疥螨好发耳缘和肘部',
    urgency: 'moderate'
  },

  {
    name: '马拉色菌皮炎',
    aliases: ['马拉色菌', '酵母菌感染', 'malassezia'],
    species: ['犬', '猫'],
    keywords: {
      breeds: ['法斗', '英斗', '巴哥', '比熊', '西高地', '贵宾', '泰迪'],
      locations: ['耳部', '爪部', '腋下', '腹股沟', '面部', '褶皱'],
      symptoms: ['油腻', '异味', '发红', '增厚', '瘙痒', '黑色', '色素沉着', '耳垢']
    },
    typicalFeatures: '皮肤油腻发红、增厚伴色素沉着，常有霉味/酸臭味，好发潮湿褶皱区域',
    ddx: '与脓皮病区分：马拉色菌特征为油腻性皮炎和异味，脓皮病为脓疱和环形结痂',
    urgency: 'low',
    relatedDiseases: [
      { name: '特应性皮炎（环境过敏）', relation: '原发', desc: '过敏是马拉色菌过度增殖的常见基础' },
      { name: '甲状腺功能减退相关皮肤改变', relation: '原发', desc: '甲减皮肤改变可继发马拉色菌' }
    ]
  },

  {
    name: '皮肤癣菌病（犬猫）',
    aliases: ['猫癣', '犬癣', '钱癣', '皮肤癣菌', '真菌', 'ringworm', 'dermatophytosis'],
    species: ['犬', '猫'],
    keywords: {
      breeds: ['英短', '美短', '布偶', '加菲', '异短', '田园猫', '狸花猫', '暹罗'],
      locations: ['面部', '耳部', '爪部', '躯干', '全身'],
      symptoms: ['圆形脱毛', '鳞屑', '结痂', '断毛', '不痒', '轻度瘙痒', '传染人', '多宠']
    },
    typicalFeatures: '圆形或不规则脱毛区，覆灰白色鳞屑和结痂，毛发折断，猫常不痒，幼年动物和多宠家庭多发',
    ddx: '与蠕形螨区分：癣菌通常圆形脱毛、鳞屑明显、轻痒或不痒；人也有皮损是重要线索',
    urgency: 'moderate'
  },

  {
    name: '趾间脓皮病（趾间炎）',
    aliases: ['趾间炎', '趾间红肿', 'interdigital pyoderma'],
    species: ['犬'],
    keywords: {
      breeds: ['柴犬', '法斗', '英斗', '拉布拉多', '金毛'],
      locations: ['爪部', '趾间', '脚趾', '脚掌'],
      symptoms: ['红肿', '舔舐', '舔爪', '反复', '趾间', '脓疱', '结节', '跛行']
    },
    typicalFeatures: '趾间皮肤红肿、潮湿，可能有脓疱或结节，犬频繁舔爪，慢性反复发作，双侧多见',
    ddx: '与蠕形螨爪型区分：趾间炎以红肿和舔舐为主，蠕形螨有更广泛脱毛；与接触性皮炎区分：接触性通常四爪对称',
    urgency: 'low'
  },

  {
    name: '肢端舔舐性肉芽肿',
    aliases: ['舔舐肉芽肿', '肢端舔舐', 'acral lick granuloma'],
    species: ['犬'],
    keywords: {
      breeds: ['拉布拉多', '金毛', '德牧', '大丹'],
      locations: ['前肢', '腕部', '爪部', '跗关节'],
      symptoms: ['舔舐', '结节', '溃疡', '增厚', '脱毛', '顽固', '慢性', '反复']
    },
    typicalFeatures: '前肢腕部附近圆形脱毛区，皮肤增厚形成结节/溃疡，表面光滑或有结痂，犬持续舔舐',
    ddx: '与深部脓皮病区分：舔舐肉芽肿为肢侧面单个边界清的顽固斑块或结节、与强迫性舔舐相关，深部脓皮病多灶且伴瘘管流脓。与趾间脓皮病区分：舔舐肉芽肿在腕或跖侧面而非趾间。与皮肤肿瘤区分：外观可相似，单个顽固不愈结节需活检排除肥大细胞瘤等。',
    urgency: 'low'
  },

  {
    name: '皮脂溢性皮炎',
    aliases: ['脂溢性皮炎', '皮脂溢', 'seborrhea'],
    species: ['犬'],
    keywords: {
      breeds: ['柴犬', '可卡', '巴哥', '沙皮', '德牧', '拉布拉多'],
      locations: ['背部', '躯干', '面部', '耳部', '尾部'],
      symptoms: ['皮屑', '鳞屑', '油腻', '异味', '脱毛', '增厚', '角化']
    },
    typicalFeatures: '皮肤脱屑（干性）或油腻（油性），伴脱毛和皮肤增厚，可能继发细菌或马拉色菌感染',
    ddx: '与真菌区分：脂溢性皮炎通常广泛分布、双侧对称，无传染性',
    urgency: 'low'
  },

  {
    name: '皮肤褶皱皮炎',
    aliases: ['褶皱皮炎', '褶皱炎', 'skin fold dermatitis'],
    species: ['犬'],
    keywords: {
      breeds: ['法斗', '英斗', '巴哥', '沙皮', '加菲', '异短'],
      locations: ['面部', '鼻部', '唇部', '尾部', '腋下', '腹股沟', '褶皱'],
      symptoms: ['红肿', '异味', '潮湿', '糜烂', '瘙痒', '摩擦', '舔舐']
    },
    typicalFeatures: '皮肤褶皱深处红肿、潮湿、糜烂，有异味，因褶皱摩擦和潮湿环境导致',
    ddx: '与马拉色菌区分：褶皱皮炎是局部解剖问题，马拉色菌多为广泛性',
    urgency: 'moderate'
  },

  {
    name: '锌反应性皮病',
    aliases: ['锌缺乏', '锌反应性', 'zinc-responsive dermatosis'],
    species: ['犬'],
    keywords: {
      breeds: ['哈士奇', '阿拉斯加', '萨摩', '柴犬'],
      locations: ['面部', '鼻部', '唇部', '爪部', '肘部', '跗关节'],
      symptoms: ['结痂', '角化', '增厚', '裂纹', '脱毛', '硬皮']
    },
    typicalFeatures: '鼻部、唇缘和压力点出现结痂、角化和裂纹，哈士奇等北欧犬种好发',
    ddx: '与鼻/足垫角化过度区分：锌反应性是营养代谢病，好发北欧犬种（哈士奇、阿拉斯加、萨摩），鼻镜口周对称结痂、补锌后改善；角化过度多为老年退行、局限鼻镜或足垫、无补锌反应。与压力性胼胝区分：锌反应性累及鼻唇和多处皮肤黏膜交界，胼胝仅限肘、跗等卧地压力点。与落叶型天疱疮区分：天疱疮有脓疱和大范围叶状结痂、可全身对称扩散，锌反应性以角化结痂为主。',
    urgency: 'low'
  },

  {
    name: '日光性皮炎',
    aliases: ['日光性角化', '晒伤', 'solar dermatitis'],
    species: ['犬'],
    keywords: {
      breeds: ['边牧', '澳牧', '白毛犬'],
      locations: ['鼻部', '面部', '腹部', '腹股沟'],
      symptoms: ['红斑', '结痂', '溃疡', '色素', '毛发稀疏', '白色']
    },
    typicalFeatures: '鼻部或腹部无毛区红斑、结痂和溃疡，日光暴露加重，白色毛发区好发，长期可恶变',
    ddx: '与锌反应性皮病区分：日光性皮炎好发白色毛发和无色素区，与日照相关',
    urgency: 'moderate'
  },

  {
    name: '接触性皮炎',
    aliases: ['接触过敏', '刺激', 'contact dermatitis'],
    species: ['犬', '猫'],
    keywords: {
      breeds: [],
      locations: ['腹部', '腹股沟', '爪部', '鼻部', '面部', '无毛区'],
      symptoms: ['红肿', '瘙痒', '水疱', '糜烂', '突然', '接触', '地面', '清洁剂', '植物']
    },
    typicalFeatures: '接触部位（腹部、爪部、无毛区）急性红斑、水疱或糜烂，去除接触源后好转',
    ddx: '与过敏区分：接触性皮炎有明确接触史，病变限于接触部位',
    urgency: 'moderate'
  },

  {
    name: '毛囊炎',
    aliases: ['细菌性毛囊炎', 'folliculitis'],
    species: ['犬'],
    keywords: {
      breeds: ['法斗', '英斗', '巴哥', '贵宾', '泰迪'],
      locations: ['腹部', '腋下', '腹股沟', '颈部'],
      symptoms: ['丘疹', '脓疱', '红斑', '脱毛', '结痂', '毛囊']
    },
    typicalFeatures: '毛囊性丘疹和脓疱，腹部无毛区明显，可发展为环形表皮领圈和结痂',
    ddx: '与热点区分：毛囊炎为散在丘疹脓疱，热点为大范围急性渗出',
    urgency: 'moderate'
  },

  {
    name: '肛周瘘管',
    aliases: ['肛周瘘', '肛周脓皮病', 'perianal fistula'],
    species: ['犬'],
    keywords: {
      breeds: ['德牧', '爱尔兰 setter'],
      locations: ['肛周', '尾部', '臀部'],
      symptoms: ['瘘管', '溃疡', '引流', '疼痛', '舔舐', '排便困难', '便秘', '便血']
    },
    typicalFeatures: '肛周皮肤多个引流性瘘管和溃疡，排便疼痛，德牧好发',
    ddx: '与肛周腺瘤区分：瘘管为炎性溃疡性病变，腺瘤为结节肿块',
    urgency: 'urgent'
  },

  {
    name: '落叶型天疱疮',
    aliases: ['天疱疮', 'pemphigus foliaceus'],
    species: ['犬', '猫'],
    keywords: {
      breeds: ['柴犬', '可卡', '秋田', '纽芬兰'],
      locations: ['面部', '鼻部', '耳部', '躯干', '爪部', '全身'],
      symptoms: ['脓疱', '结痂', '鳞屑', '脱毛', '对称', '面部', '鼻部']
    },
    typicalFeatures: '面部和鼻部开始的大范围浅表脓疱和叶状结痂，对称分布，常扩展至全身',
    ddx: '与脓皮病区分：天疱疮结痂更广泛、面部和鼻部起始，需活检确诊',
    urgency: 'moderate'
  },

  // ── 猫常见 ──

  {
    name: '猫粟粒性皮炎（跳蚤过敏）',
    aliases: ['粟粒性皮炎', '猫跳蚤过敏', 'miliary dermatitis'],
    species: ['猫'],
    keywords: {
      breeds: ['英短', '美短', '布偶', '田园猫'],
      locations: ['背部', '腰部', '颈部', '头部', '尾根'],
      symptoms: ['结痂', '粟粒', '瘙痒', '抓挠', '脱毛', '红疹', '小米粒']
    },
    typicalFeatures: '背部和颈部大量小米粒大小结痂性丘疹，猫频繁抓挠，跳蚤过敏最常见表现',
    ddx: '与猫癣区分：粟粒性皮炎为多发小丘疹结痂伴剧痒，癣菌为圆形脱毛鳞屑',
    urgency: 'low',
    relatedDiseases: [
      { name: '跳蚤过敏性皮炎', relation: '原发', desc: '跳蚤过敏是粟粒性皮炎最常见的原因' },
      { name: '猫过敏性皮炎（非跳蚤非食物）', relation: '鉴别', desc: '排除跳蚤后考虑环境过敏' }
    ]
  },

  {
    name: '嗜酸性肉芽肿复合体',
    aliases: ['嗜酸性肉芽肿', 'EGC', 'eosinophilic granuloma'],
    species: ['猫'],
    keywords: {
      breeds: ['美短', '暹罗', '哈瓦那'],
      locations: ['唇部', '腹部', '大腿', '爪部', '口腔'],
      symptoms: ['溃疡', '结节', '肿', '增生', '唇部', '腹股沟', '无痛']
    },
    typicalFeatures: '三种形式：嗜酸性溃疡（唇部无痛性溃疡）、嗜酸性肉芽肿（腹部/大腿黄色隆起斑块）、嗜酸性斑（腹部红色溃疡斑）',
    ddx: '与猫鳞状细胞癌区分：EGC 好发年轻猫、唇部无痛性溃疡、对糖皮质激素反应好；鳞癌好发老年白猫日照部位（耳尖、鼻、眼睑）、慢性不愈的增生性溃疡且易出血、属恶性需活检。与皮肤肿瘤区分：EGC 常多灶且年轻猫多见，肿瘤多为孤立进行性增大的结节，细胞学或活检可鉴别。',
    urgency: 'moderate'
  },

  {
    name: '猫痤疮',
    aliases: ['猫下巴痤疮', '下巴黑点', 'feline acne'],
    species: ['猫'],
    keywords: {
      breeds: ['波斯', '异国短毛', '加菲', '英短'],
      locations: ['下巴', '唇部', '面部'],
      symptoms: ['黑点', '粉刺', '黑头', '红肿', '结痂', '下巴', '脏']
    },
    typicalFeatures: '下巴和唇部出现黑色粉刺、红肿和结痂，可继发毛囊炎和脓皮病',
    ddx: '与真菌区分：痤疮局限于下巴，真菌通常圆形脱毛和鳞屑',
    urgency: 'low'
  },

  {
    name: '猫心理性脱毛',
    aliases: ['心理性脱毛', '过度舔毛', 'psychogenic alopecia'],
    species: ['猫'],
    keywords: {
      breeds: ['暹罗', '东方短毛', '阿比西尼亚', '布偶', '英短'],
      locations: ['腹部', '背部', '腿部', '全身'],
      symptoms: ['脱毛', '舔毛', '过度舔', '无瘙痒', '对称', '短毛', '压力', '焦虑']
    },
    typicalFeatures: '腹部和腿部对称性短毛或脱毛，无皮肤病变（无红斑、结痂），猫过度舔毛',
    ddx: '与过敏区分：心理性脱毛无原发皮损，毛发被舔断而非脱落；与内分泌脱毛区分',
    urgency: 'low'
  },

  {
    name: '猫浆细胞性足炎',
    aliases: ['肉垫炎', '足皮炎', 'plasma cell pododermatitis'],
    species: ['猫'],
    keywords: {
      breeds: [],
      locations: ['爪部', '肉垫', '脚掌', '趾', '脚垫'],
      symptoms: ['肉垫', '肿', '紫', '充血', '跛行', '脚垫', '肿胀']
    },
    typicalFeatures: '脚垫肿大、发紫或充血，可能溃疡出血，猫特异性疾病，常双侧多趾受累',
    ddx: '与外伤区分：双侧多趾同时受累是特征，外伤通常单侧单趾',
    urgency: 'moderate'
  },

  {
    name: '猫日光性皮炎',
    aliases: ['晒伤', 'solar dermatitis'],
    species: ['猫'],
    keywords: {
      breeds: ['白猫', '白色'],
      locations: ['耳部', '耳尖', '鼻部', '面部', '眼睑'],
      symptoms: ['红斑', '结痂', '溃疡', '白色', '耳尖', '晒']
    },
    typicalFeatures: '白色猫耳尖和鼻部红斑、结痂和溃疡，日光暴露加重，长期可发展为鳞癌',
    ddx: '与过敏区分：日光性皮炎限于无色素区，白猫好发，耳尖和鼻部起始',
    urgency: 'moderate'
  },

  {
    name: '猫鳞状细胞癌',
    aliases: ['鳞癌', 'SCC', 'squamous cell carcinoma'],
    species: ['猫'],
    keywords: {
      breeds: ['白猫', '白色'],
      locations: ['耳部', '耳尖', '鼻部', '面部', '眼睑', '口唇'],
      symptoms: ['溃疡', '不愈', '增生', '出血', '白色', '耳尖', '肿块']
    },
    typicalFeatures: '白色猫耳尖、鼻部或眼睑的慢性不愈合溃疡和增生性病变，表面凹凸不平',
    ddx: '与猫日光性皮炎区分：日光性皮炎是红斑结痂的癌前阶段，鳞癌已发展为增生性溃疡或肿块、慢性不愈、需活检确诊。与嗜酸性肉芽肿复合体区分：鳞癌好发老年白猫日照部位（耳尖、鼻、眼睑）、进行性增生出血、恶性；EGC 好发年轻猫唇部、无痛性溃疡、激素反应好。任何白猫耳尖或鼻部的不愈溃疡都应尽快活检排除鳞癌。',
    urgency: 'urgent'
  },

  {
    name: '猫面部褶皱皮炎',
    aliases: ['面部褶皱', '鼻部褶皱', 'facial fold dermatitis'],
    species: ['猫'],
    keywords: {
      breeds: ['加菲', '异短', '波斯', '扁脸'],
      locations: ['面部', '鼻部', '眼周', '褶皱'],
      symptoms: ['红肿', '分泌物', '异味', '摩擦', '潮湿', '褶皱']
    },
    typicalFeatures: '扁脸猫面部和鼻部褶皱深处红肿、潮湿、有分泌物和异味',
    ddx: '与泪痕皮炎区分：褶皱皮炎在鼻部褶皱深处，泪痕在眼下方浸渍',
    urgency: 'moderate'
  },

  {
    name: '猫尾根腺炎（尾部皮脂腺炎）',
    aliases: ['尾根', '尾部皮脂腺', 'stud tail'],
    species: ['猫'],
    keywords: {
      breeds: ['公猫', '波斯', '异国短毛', '加菲'],
      locations: ['尾部', '尾根', '背部'],
      symptoms: ['油腻', '黑点', '分泌物', '蜡样', '毛发粘连', '尾根']
    },
    typicalFeatures: '尾根背部皮脂腺过度分泌，毛发油腻、蜡样粘连，伴黑色颗粒',
    ddx: '与跳蚤区分：尾根腺炎是皮脂分泌异常无瘙痒，跳蚤过敏有剧烈瘙痒',
    urgency: 'low'
  },

  {
    name: '猫疥螨病',
    aliases: ['猫疥螨', '猫疥疮', 'notoedric mange'],
    species: ['猫'],
    keywords: {
      breeds: ['幼猫', '免疫低下猫', '流浪猫', '田园猫'],
      locations: ['面部', '耳部', '耳尖', '鼻部', '爪部'],
      symptoms: ['剧烈瘙痒', '结痂', '增厚', '皱褶', '传染', '人也有', '皮屑']
    },
    typicalFeatures: '从耳尖和面部开始剧烈瘙痒、结痂和皮肤增厚皱褶，人接触也可瘙痒',
    ddx: '与耳螨区分：猫疥螨从耳尖和面部皮肤开始，耳螨主要在耳道内',
    urgency: 'moderate'
  },

  {
    name: '猫泪痕皮炎',
    category: 'feline',
    aliases: ['泪痕', '眼周皮炎', 'tear stain'],
    species: ['猫'],
    keywords: {
      breeds: ['加菲', '异短', '波斯', '扁脸'],
      locations: ['眼周', '面部', '鼻部'],
      symptoms: ['泪痕', '红褐', '潮湿', '红肿', '眼', '分泌物', '流泪']
    },
    typicalFeatures: '眼下方皮肤因泪液浸渍红肿、红褐色染色和潮湿，扁脸猫多见',
    ddx: '与面部褶皱皮炎区分：泪痕在眼下方浸渍，褶皱皮炎在鼻部褶皱深处',
    urgency: 'low'
  },

  {
    name: '猫皮肤脆弱症',
    aliases: ['皮肤脆弱', 'skin fragility'],
    species: ['猫'],
    keywords: {
      breeds: ['布偶', '波斯'],
      locations: ['全身', '背部', '躯干'],
      symptoms: ['撕裂', '薄', '伤口', '出血', '脆弱', '破损', '裂开']
    },
    typicalFeatures: '皮肤极薄易撕裂，轻微触碰即可造成裂伤，多继发于库兴综合征',
    ddx: '与外伤区分：皮肤脆弱症为多发性无痛性撕裂，非外力导致',
    urgency: 'urgent'
  },

  {
    name: '猫蠕形螨病',
    aliases: ['猫蠕形螨', 'feline demodicosis'],
    species: ['猫'],
    keywords: {
      breeds: ['暹罗', '布偶', '免疫低下猫'],
      locations: ['面部', '眼周', '头部', '耳部', '颈部'],
      symptoms: ['脱毛', '皮屑', '瘙痒', '红斑', '眼周', '鳞屑']
    },
    typicalFeatures: '面部和眼周脱毛、皮屑和红斑，猫蠕形螨通常瘙痒比犬明显',
    ddx: '与犬蠕形螨区分：猫蠕形螨好发头面部和眼周，瘙痒更明显',
    urgency: 'moderate'
  },

  {
    name: '猫浅表脓皮病',
    aliases: ['猫细菌感染', 'feline pyoderma'],
    species: ['猫'],
    keywords: {
      breeds: ['英短', '美短', '布偶', '波斯'],
      locations: ['腹部', '躯干', '面部', '爪部', '下巴'],
      symptoms: ['丘疹', '脓疱', '结痂', '脱毛', '红斑', '溃疡']
    },
    typicalFeatures: '丘疹、脓疱、结痂和脱毛，常继发于跳蚤过敏、猫癣或食物过敏',
    ddx: '与猫癣区分：脓皮病通常有脓疱，癣菌为圆形脱毛鳞屑无脓疱',
    urgency: 'moderate',
    relatedDiseases: [
      { name: '猫粟粒性皮炎（跳蚤过敏）', relation: '原发', desc: '跳蚤过敏是猫脓皮病常见诱因' },
      { name: '皮肤癣菌病（犬猫）', relation: '原发', desc: '猫癣可继发细菌感染' },
      { name: '猫过敏性皮炎（非跳蚤非食物）', relation: '原发', desc: '过敏可导致反复脓皮病' }
    ]
  },

  {
    name: '猫注射部位肉瘤',
    aliases: ['注射部位肉瘤', '纤维肉瘤', 'injection site sarcoma'],
    species: ['猫'],
    keywords: {
      breeds: [],
      locations: ['肩胛', '腰部', '大腿', '注射部位', '背部'],
      symptoms: ['肿块', '结节', '增大', '硬', '无痛', '注射', '疫苗']
    },
    typicalFeatures: '注射部位（肩胛间、腰部或大腿）出现的皮下硬结节，持续增大，可能溃烂',
    ddx: '与囊肿区分：注射部位肉瘤持续增大、位置在常见注射点，活检确诊',
    urgency: 'urgent'
  },

  {
    name: '猫甲状腺功能亢进相关皮肤改变',
    aliases: ['猫甲亢', '甲亢皮肤病', 'feline hyperthyroidism'],
    species: ['猫'],
    keywords: {
      breeds: ['老年猫', '英短', '美短', '田园猫'],
      locations: ['腹部', '躯干', '背部', '全身'],
      symptoms: ['对称脱毛', '皮肤变薄', '皮屑', '毛发粗乱', '体重下降', '多饮多尿', '慢性']
    },
    typicalFeatures: '老年猫双侧对称脱毛、皮肤变薄、毛发粗乱无光泽，常伴体重下降、多饮多尿和食欲亢进',
    ddx: '与猫心理性脱毛区分：甲亢有原发皮损（皮肤变薄）和全身症状；与库兴综合征区分：猫甲亢更常见体重下降而非腹部膨大',
    urgency: 'moderate'
  },

  {
    name: '猫过敏性皮炎（非跳蚤非食物）',
    category: 'allergy',
    aliases: ['猫环境过敏', '猫特应性皮炎', 'feline atopic dermatitis'],
    species: ['猫'],
    keywords: {
      breeds: ['暹罗', '东方短毛', '阿比西尼亚', '布偶'],
      locations: ['面部', '耳部', '爪部', '腹部', '全身'],
      symptoms: ['瘙痒', '反复', '季节性', '慢性', '舔爪', '抓挠', '粟粒', '结痂']
    },
    typicalFeatures: '慢性或季节性反复瘙痒，可表现为粟粒性皮炎、嗜酸性肉芽肿或对称性脱毛等多种反应模式，排除跳蚤和食物过敏后考虑',
    ddx: '与跳蚤过敏区分：非跳蚤非食物过敏在严格驱虫和排除饮食试验后仍反复；与心理性脱毛区分：过敏性有原发皮损和瘙痒',
    urgency: 'low'
  },

  // ── 犬猫共患 ──

  {
    name: '耳螨感染',
    aliases: ['耳螨', '耳痒螨', 'otodectes', 'ear mites'],
    species: ['犬', '猫'],
    keywords: {
      breeds: ['英短', '美短', '布偶', '加菲', '猫'],
      locations: ['耳部', '耳道', '耳朵'],
      symptoms: ['黑褐色', '分泌物', '甩头', '抓耳', '耳垢', '黑色', '蜡样', '搔抓']
    },
    typicalFeatures: '双侧耳道大量黑褐色蜡样分泌物，动物频繁甩头和抓耳，猫多发，耳道皮肤红肿',
    ddx: '与马拉色菌性外耳炎区分：耳螨分泌物为干燥黑褐色蜡样，马拉色菌为油腻有臭味',
    urgency: 'moderate'
  },

  {
    name: '马拉色菌性外耳炎',
    aliases: ['马拉色菌耳炎', '酵母菌耳炎', 'malassezia otitis'],
    species: ['犬', '猫'],
    keywords: {
      breeds: ['法斗', '英斗', '巴哥', '可卡', '比熊', '贵宾'],
      locations: ['耳部', '耳道', '耳朵'],
      symptoms: ['分泌物', '油腻', '异味', '臭味', '红肿', '瘙痒', '耳垢', '黄褐色']
    },
    typicalFeatures: '耳道黄褐色油腻分泌物，有酸臭/霉味，耳道皮肤红肿增厚，垂耳犬好发',
    ddx: '与耳螨区分：马拉色菌分泌物油腻有臭味，耳螨为干燥黑褐色蜡样',
    urgency: 'moderate'
  },

  {
    name: '细菌性外耳炎',
    aliases: ['细菌耳炎', '外耳炎', 'bacterial otitis'],
    species: ['犬', '猫'],
    keywords: {
      breeds: ['拉布拉多', '金毛', '可卡', '法斗'],
      locations: ['耳部', '耳道', '耳朵'],
      symptoms: ['脓性', '分泌物', '红肿', '疼痛', '甩头', '化脓', '臭味', '溃疡']
    },
    typicalFeatures: '耳道脓性分泌物、红肿、疼痛，可能有溃疡，常继发于耳螨或过敏',
    ddx: '与耳螨区分：细菌性外耳炎分泌物为脓性，耳螨为干燥黑褐色蜡样',
    urgency: 'moderate'
  },

  {
    name: '皮脂腺囊肿',
    aliases: ['皮脂腺瘤', '粉瘤', 'sebaceous cyst'],
    species: ['犬', '猫'],
    keywords: {
      breeds: ['贵宾', '泰迪', '比熊', '博美', '西高地'],
      locations: ['躯干', '背部', '头部', '四肢'],
      symptoms: ['结节', '肿块', '包', '隆起', '囊性', '白色', '内容物', '不痛']
    },
    typicalFeatures: '皮肤下圆形隆起结节，内容物为白色/黄褐色皮脂样物，通常无痛',
    ddx: '与肿瘤区分：囊肿内容物为皮脂，有波动感；与脓肿区分：脓肿有红肿热痛',
    urgency: 'low'
  },

  {
    name: '蜱虫叮咬',
    aliases: ['蜱虫', '壁虱', 'tick bite'],
    species: ['犬', '猫'],
    keywords: {
      breeds: [],
      locations: ['耳部', '头部', '颈部', '趾间', '腹部'],
      symptoms: ['虫体', '附着', '叮咬', '红肿', '硬结', '草丛', '户外']
    },
    typicalFeatures: '皮肤上可见附着蜱虫体，周围红肿，拔除后可有硬结，多发于户外活动后',
    ddx: '与其他寄生虫区分：蜱虫体可见附着，是重要鉴别特征',
    urgency: 'moderate'
  },

  {
    name: '蚊虫叮咬/昆虫过敏',
    aliases: ['蚊虫叮咬', '虫咬', '昆虫叮咬', 'insect bite'],
    species: ['犬', '猫'],
    keywords: {
      breeds: [],
      locations: ['鼻部', '面部', '口鼻', '耳部', '无毛区'],
      symptoms: ['肿胀', '突然', '红肿', '突起', '蚊', '蜂', '夏天', '户外']
    },
    typicalFeatures: '突然出现的面部/鼻部肿胀，可能伴红疹，有户外暴露史，数小时内可消退或加重',
    ddx: '与过敏性肿胀区分：虫咬通常突然发作、局部肿胀，有户外史',
    urgency: 'moderate'
  },

  {
    name: '皮肤肿瘤（肥大细胞瘤等）',
    aliases: ['肥大细胞瘤', '肿瘤', '肿块', 'mast cell tumor'],
    species: ['犬', '猫'],
    keywords: {
      breeds: ['法斗', '巴哥', '金毛', '拉布拉多', '边牧', '暹罗'],
      locations: ['躯干', '四肢', '头部', '腹部'],
      symptoms: ['结节', '肿块', '增大', '溃疡', '不愈', '变色', '出血', '波动']
    },
    typicalFeatures: '皮肤结节或肿块，大小不一，可能溃疡或波动，肥大细胞瘤可红肿、波动',
    ddx: '与皮脂腺囊肿区分：肿瘤常持续增大、可溃疡出血、质地不均，囊肿有波动感、内容物为皮脂、长期稳定。与脓肿/蜂窝织炎区分：脓肿急性红肿热痛、有波动和脓液、常有咬伤史，肿瘤多为无痛渐进增大。与嗜酸性肉芽肿区分（猫）：肿瘤孤立进行性，EGC 年轻猫多灶且激素反应好。任何不愈合溃疡或进行性增大肿块都应细针抽吸或活检。',
    urgency: 'urgent'
  },

  {
    name: '脓肿/蜂窝织炎',
    aliases: ['脓肿', '蜂窝织炎', 'abscess', 'cellulitis'],
    species: ['犬', '猫'],
    keywords: {
      breeds: [],
      locations: ['面部', '颈部', '四肢', '尾根', '背部'],
      symptoms: ['突然', '红肿', '热痛', '波动', '流脓', '破溃', '咬伤', '疼痛']
    },
    typicalFeatures: '局部突然红肿热痛，可有波动感、破溃或脓性分泌物，常见于咬伤或穿刺后感染',
    ddx: '与肿瘤区分：脓肿常急性、疼痛和发热，肿瘤通常持续增大但不一定热痛',
    urgency: 'urgent'
  },

  {
    name: '皮肤创伤/擦伤',
    aliases: ['擦伤', '外伤', '抓伤', 'trauma', 'abrasion'],
    species: ['犬', '猫'],
    keywords: {
      breeds: [],
      locations: ['四肢', '面部', '腹部', '背部', '尾部'],
      symptoms: ['破皮', '擦伤', '出血', '结痂', '疼痛', '舔舐', '外伤', '抓伤']
    },
    typicalFeatures: '局部线状或片状表浅破损、结痂或少量出血，常有明确外伤、抓挠或摩擦史',
    ddx: '与感染性皮炎区分：创伤边界常与摩擦/抓伤路径一致，若继发红肿流脓需考虑感染',
    urgency: 'moderate'
  },

  {
    name: '压力性胼胝/肘部胼胝',
    aliases: ['胼胝', '肘部胼胝', 'callus dermatitis', 'pressure callus'],
    species: ['犬'],
    keywords: {
      breeds: ['拉布拉多', '金毛', '德牧', '大丹', '大型犬'],
      locations: ['肘部', '跗关节', '胸骨', '压力点'],
      symptoms: ['增厚', '脱毛', '硬皮', '粗糙', '裂纹', '结痂', '压力点']
    },
    typicalFeatures: '大型犬压力点局部脱毛、皮肤增厚粗糙和角化，长期卧硬地更明显，可继发感染',
    ddx: '与鼻/足垫角化过度区分：胼胝在肘、跗、胸骨等卧地骨突压力点、与硬地摩擦史相关，角化过度在鼻镜和足垫承重面。与锌反应性皮病区分：胼胝为局部机械性、无品种和补锌关联，锌反应性累及鼻唇多处并好发北欧犬种。与深部脓皮病区分：单纯胼胝无脓性渗出和瘘管，若压力点继发感染出现流脓需按深部脓皮病处理。',
    urgency: 'low'
  },

  {
    name: '鼻/足垫角化过度',
    aliases: ['角化过度', '鼻部角化', '足垫角化', 'hyperkeratosis'],
    species: ['犬'],
    keywords: {
      breeds: ['拉布拉多', '金毛', '可卡', '法斗', '老年犬'],
      locations: ['鼻部', '足垫', '爪部'],
      symptoms: ['角化', '增厚', '干裂', '硬皮', '裂纹', '粗糙', '跛行']
    },
    typicalFeatures: '鼻镜或足垫过度角化、干裂和硬皮样增厚，严重时可裂开疼痛或跛行',
    ddx: '与锌反应性皮病区分：角化过度好发老年犬、局限鼻镜或足垫承重面、无品种和营养关联；锌反应性好发北欧犬种、鼻唇多处受累、对补锌有反应。与压力性胼胝区分：角化过度在鼻镜和足垫承重面，胼胝在肘、跗、胸骨等骨突压力点、与卧硬地相关。与落叶型天疱疮区分：天疱疮伴脓疱结痂且多部位对称扩散，单纯角化过度只有厚硬角质、无脓疱。',
    urgency: 'low'
  },

  {
    name: '甲状腺功能减退相关皮肤改变',
    aliases: ['甲减皮肤病', '内分泌脱毛', 'hypothyroidism'],
    species: ['犬'],
    keywords: {
      breeds: ['金毛', '拉布拉多', '杜宾', '可卡', '腊肠'],
      locations: ['躯干', '尾部', '背部', '颈部'],
      symptoms: ['对称脱毛', '尾巴脱毛', '皮肤增厚', '色素沉着', '乏力', '肥胖', '慢性']
    },
    typicalFeatures: '非瘙痒性双侧对称脱毛、尾部脱毛、皮肤增厚和色素沉着，常伴乏力或体重增加',
    ddx: '与蠕形螨区分：甲减通常慢性对称、瘙痒轻或无，需血液内分泌检查而非仅靠皮肤外观',
    urgency: 'moderate'
  },

  {
    name: '库兴综合征相关皮肤改变',
    aliases: ['库兴', '肾上腺皮质功能亢进', 'cushing', 'hyperadrenocorticism'],
    species: ['犬'],
    keywords: {
      breeds: ['贵宾', '腊肠', '梗犬', '博美'],
      locations: ['腹部', '躯干', '背部', '全身'],
      symptoms: ['皮肤变薄', '对称脱毛', '黑头', '钙化', '腹部膨大', '多饮多尿', '慢性']
    },
    typicalFeatures: '躯干对称脱毛、皮肤变薄、黑头或钙化沉着，可伴腹部膨大、多饮多尿',
    ddx: '与普通过敏区分：库兴相关皮肤改变通常不以剧痒为主，伴全身内分泌线索',
    urgency: 'moderate'
  },

  {
    name: '姬螯螨病（行走的皮屑）',
    aliases: ['姬螯螨', '行走的皮屑', 'cheyletiellosis', 'walking dandruff'],
    species: ['犬', '猫'],
    keywords: {
      breeds: [],
      locations: ['背部', '颈部', '躯干'],
      symptoms: ['大量皮屑', '鳞屑', '瘙痒', '传染', '幼宠', '多宠', '人也痒']
    },
    typicalFeatures: '背部和躯干大量白色皮屑样鳞屑，轻到中度瘙痒，多宠或幼宠环境可传播给人',
    ddx: '与普通干性皮屑区分：姬螯螨更常多宠传播，胶带检查或梳检可能发现螨体/卵',
    urgency: 'moderate'
  },

  {
    name: '虱感染',
    aliases: ['虱子', '咬虱', 'lice infestation', 'pediculosis'],
    species: ['犬', '猫'],
    keywords: {
      breeds: [],
      locations: ['颈部', '背部', '耳部', '全身'],
      symptoms: ['虫体', '虱卵', '瘙痒', '皮屑', '毛发粗乱', '贫血', '多宠']
    },
    typicalFeatures: '毛干上可见虱卵或小虫体，伴瘙痒、皮屑和毛发粗乱，幼弱动物严重时可贫血',
    ddx: '与跳蚤区分：虱卵常固定在毛干上，跳蚤和跳蚤粪多可在皮表或梳检中移动/脱落',
    urgency: 'moderate'
  }
]

// ============================================================
// 文档补充知识库（来源：常见皮肤病诊断.docx，已去处方化清洗）
// 只合并能提升检索与鉴别的字段；具体药物、剂量、疗程不进入用户报告。
// ============================================================

var SUPPLEMENTAL_DISEASE_KB = [
  {
    targetName: '急性湿性皮炎（热点）',
    name: '脓性创伤性皮炎',
    aliases: ['脓性创伤性皮炎', '湿热性皮炎', '热斑'],
    keywords: {
      breeds: ['法斗', '英斗'],
      locations: ['躯干', '尾根', '大腿外侧'],
      symptoms: ['快速扩大', '皮肤发热', '渗液', '淡黄色浆液', '脓液', '一夜烂一块', '疯狂抓挠', '皮肤渗水', '红肿发热']
    },
    typicalFeatures: '短时间爆发的湿性糜烂和渗液，常在抓咬后迅速扩大，患处可发热疼痛。',
    ddx: '与浅表脓皮病区分：热点是整片湿烂持续渗出，浅表脓皮病更常见毛囊性丘疹、脓疱和表皮环。与皮肤癣菌病区分：癣菌病程慢、干燥脱毛鳞屑明显，通常没有急性大量渗液。',
    redFlags: ['24小时内极速扩大', '大面积皮下肿胀', '发热精神差', '多处同步爆发']
  },
  {
    targetName: '浅表脓皮病',
    name: '浅表细菌性毛囊炎（浅表脓皮病）',
    aliases: ['浅表细菌性毛囊炎', '表层细菌性脓皮症', '毛囊性脓皮病'],
    keywords: {
      locations: ['背部', '躯干两侧', '腰臀部'],
      symptoms: ['毛囊中心红点', '表皮环', '环形鳞屑脱毛斑', '虫蛀样脱毛', '毛发发红变色', '结痂反复', '小红疙瘩']
    },
    typicalFeatures: '以毛囊为中心的丘疹、脓疱和薄痂，常伴环形表皮环或虫蛀样脱毛。',
    ddx: '与蠕形螨病区分：蠕形螨脱毛范围更大、黑头和皮屑可更明显，需刮片确认。与皮肤癣菌病区分：癣菌更偏圆形干燥脱毛和断毛，真菌检查可鉴别。',
    redFlags: ['丘疹大量融合成片', '向深层感染发展', '长期反复感染']
  },
  {
    targetName: '深部脓皮病',
    name: '深层细菌性脓皮病',
    aliases: ['深层细菌性脓皮病', '深部毛囊炎', '疖病', '蜂窝织炎'],
    keywords: {
      locations: ['压力承重皮肤', '大腿', '颈部'],
      symptoms: ['皮下硬块', '流脓血', '碰就疼', '厚痂', '深层溃疡', '淋巴结增大']
    },
    typicalFeatures: '皮下硬结、深层溃疡、瘘管或脓血样渗出，通常有明显疼痛。',
    ddx: '与皮肤肿瘤区分：深部感染常急性红肿热痛并有脓性渗出，肿瘤多为渐进增大且需细胞学或病理鉴别。',
    redFlags: ['多处深部结节', '发热厌食', '大面积皮肤坏死', '疑似全身感染']
  },
  {
    targetName: '皮肤褶皱皮炎',
    name: '皮褶炎',
    aliases: ['皮褶炎', '擦烂', '皮褶脓皮病'],
    keywords: {
      locations: ['面部褶', '口鼻褶', '唇褶', '尾褶', '会阴褶', '颈部垂皮褶'],
      symptoms: ['浸渍', '酸臭味', '腐臭味', '褶皱内积污', '褶皱臭', '发红破皮', '有臭味分泌物']
    },
    typicalFeatures: '褶皱夹缝内发红、潮湿、糜烂和异味，可因唾液、尿液、皮脂或摩擦反复刺激。',
    ddx: '与马拉色菌皮炎区分：皮褶炎首先受解剖褶皱和浸渍影响，马拉色菌可作为继发因素存在。',
    redFlags: ['深层化脓肿胀', '面部感染影响眼部', '会阴褶感染伴排尿疼痛']
  },
  {
    targetName: '马拉色菌皮炎',
    name: '马拉色菌病',
    aliases: ['马拉色菌病', '马拉色菌过度增殖'],
    keywords: {
      locations: ['颈腹侧', '肛周', '指缝'],
      symptoms: ['蜡质油腻', '油腻皮屑', '酸腐味', '皮肤苔藓化', '皮肤发黑', '反复耳炎']
    },
    typicalFeatures: '油腻、异味、红斑和色素沉着常同时出现，常继发于过敏、褶皱潮湿或内分泌问题。',
    ddx: '与浅表脓皮病区分：马拉色菌更突出油腻、异味和色素沉着，脓皮病更突出脓疱、表皮环和球菌感染。'
  },
  {
    targetName: '细菌性外耳炎',
    name: '外耳炎',
    aliases: ['化脓性外耳炎', '细菌性耳道炎'],
    keywords: {
      locations: ['耳廓', '外耳道'],
      symptoms: ['脓液', '黄绿色分泌物', '耳道红肿', '耳道疼痛', '触碰疼痛', '耳道溃疡', '化脓性分泌物']
    },
    typicalFeatures: '耳道红肿疼痛，分泌物偏脓性或黄绿色，触碰耳部可能明显抗拒。',
    ddx: '与马拉色菌性外耳炎区分：细菌性外耳炎更偏脓性、疼痛和溃疡；马拉色菌更偏油腻黄褐色分泌物和霉味。与耳螨区分：耳螨常为干燥黑褐色蜡样分泌物。'
  },
  {
    targetName: '趾间脓皮病（趾间炎）',
    name: '细菌性爪部皮炎',
    aliases: ['细菌性爪部皮炎', '爪部脓皮病'],
    keywords: {
      locations: ['甲沟', '趾缝', '足底'],
      symptoms: ['甲沟红肿', '舔咬患肢', '单爪疼痛', '爪部渗脓', '脚趾间反复红肿']
    },
    typicalFeatures: '趾间或甲沟红肿、潮湿、疼痛和舔咬，可能继发细菌或酵母感染。',
    ddx: '与接触性皮炎区分：接触性更常多爪对称，细菌性爪部皮炎可单爪明显疼痛或渗脓。'
  },
  {
    targetName: '脓肿/蜂窝织炎',
    name: '皮下咬伤脓肿',
    aliases: ['皮下咬伤脓肿', '咬伤脓肿'],
    keywords: {
      locations: ['颈部', '尾根', '背部', '脸颊'],
      symptoms: ['咬伤', '穿刺伤', '突然肿包', '脓腔', '破溃流脓', '局部热痛']
    },
    typicalFeatures: '咬伤或穿刺后出现局部热痛肿胀，随后可能破溃流脓。',
    ddx: '与皮肤肿瘤区分：咬伤脓肿常有急性热痛和感染史，肿瘤通常渐进增大。'
  },
  {
    name: '脓疱病',
    aliases: ['幼犬浅表脓疱性皮炎', '婴儿脓皮病', 'puppy impetigo'],
    species: ['犬'],
    category: 'bacterial',
    keywords: {
      breeds: ['幼犬', '短鼻犬'],
      locations: ['腹部', '腋下', '腹股沟', '无毛薄皮处'],
      symptoms: ['小水泡', '薄壁脓疱', '薄黄痂', '不怎么挠', '低龄幼犬', '未满6月龄']
    },
    typicalFeatures: '低龄幼犬腹下或腋下出现薄壁小脓疱、丘疹和薄黄痂，通常瘙痒较轻。',
    ddx: '与浅表脓皮病区分：脓疱病多见于未成熟幼犬腹下薄皮处，浅表脓皮病年龄范围更广且毛囊性更明显。与皮肤癣菌病区分：癣菌为圆形脱毛和干燥鳞屑，不以薄壁脓疱为主。',
    urgency: 'low',
    redFlags: ['脓疱融合糜烂', '幼犬精神萎靡', '体温升高']
  },
  {
    name: '下颏脓皮病（犬痤疮）',
    aliases: ['下颏脓皮病', '犬痤疮', '犬颏部毛囊炎', '下巴粉刺'],
    species: ['犬'],
    category: 'bacterial',
    keywords: {
      breeds: ['法斗', '英斗', '比格', '杜宾', '短毛青年犬'],
      locations: ['下颌', '下巴', '口鼻底部', '嘴唇下方'],
      symptoms: ['黑头粉刺', '下巴黑点', '颏部脓疱', '下巴起疙瘩', '黑皮', '啃玩具后加重']
    },
    typicalFeatures: '青年短毛犬下颏部粉刺、丘疹、脓疱或结痂，可因摩擦和潮湿反复。',
    ddx: '与猫痤疮区分：本条为犬下颏毛囊炎；与皮肤肿瘤区分：痤疮局限下颏且常见粉刺和毛囊性病变，肿瘤多为孤立进行性肿块。',
    urgency: 'low',
    redFlags: ['结节破溃形成瘘管', '肿胀蔓延至脸颊', '进食疼痛拒食']
  },
  {
    name: '细菌性甲感染',
    aliases: ['细菌性甲沟炎', '化脓性甲沟炎', '甲床感染'],
    species: ['犬', '猫'],
    category: 'paw',
    keywords: {
      breeds: [],
      locations: ['爪甲', '甲床', '甲沟', '趾甲'],
      symptoms: ['甲沟红肿', '趾甲渗脓', '趾甲疼痛', '跛行', '舔咬爪子', '指甲松动', '甲床感染']
    },
    typicalFeatures: '甲沟或甲床红肿疼痛、渗脓，动物常舔咬患趾并可能跛行。',
    ddx: '与真菌性甲感染区分：细菌性甲感染更急性、红肿流脓和疼痛明显；真菌性甲感染更慢性，表现为甲板增厚、浑浊、变脆和变形。',
    urgency: 'moderate',
    redFlags: ['甲床深部感染', '趾骨感染疑虑', '爪甲脱落', '跛行加重']
  },
  {
    name: '真菌性甲感染（甲癣）',
    aliases: ['甲癣', '真菌性甲沟炎', '灰指甲', 'onychomycosis'],
    species: ['犬', '猫'],
    category: 'fungal',
    keywords: {
      breeds: [],
      locations: ['爪甲', '甲板', '甲床', '甲沟'],
      symptoms: ['指甲变厚', '指甲发白', '指甲发黄', '浑浊', '分层脱屑', '指甲变形', '慢性迁延', '无明显化脓']
    },
    typicalFeatures: '爪甲增厚、浑浊、变脆、变形或分层，病程慢性，通常没有明显急性化脓。',
    ddx: '与细菌性甲感染区分：甲癣更慢性干燥、甲板变形明显；细菌性甲炎红肿流脓和疼痛更突出。与外伤区分：外伤多为突发单甲破损。',
    urgency: 'moderate',
    redFlags: ['全趾甲毁损', '继发细菌混合感染', '皮肤真菌扩散']
  },
  {
    name: '耳血肿',
    aliases: ['耳廓血肿', 'aural hematoma'],
    species: ['犬', '猫'],
    category: 'ear',
    keywords: {
      breeds: ['垂耳犬'],
      locations: ['耳廓', '耳部'],
      symptoms: ['耳朵鼓包', '耳廓肿胀', '甩头', '抓耳', '耳朵像气球', '波动感', '疼痛']
    },
    typicalFeatures: '耳廓突然出现柔软或有波动感的肿胀，常继发于外耳炎、耳螨或剧烈甩头抓耳。',
    ddx: '与外耳炎区分：耳血肿的主要问题是耳廓囊性肿胀，外耳炎主要表现为耳道红肿分泌物和异味。',
    urgency: 'moderate',
    redFlags: ['耳廓快速肿大', '明显疼痛', '伴严重外耳炎']
  },
  {
    name: '肛门囊病',
    aliases: ['肛门腺炎', '肛门囊炎', '肛门腺堵塞', 'anal sac disease'],
    species: ['犬', '猫'],
    category: 'rare_warning',
    keywords: {
      breeds: ['小型犬', '肥胖犬'],
      locations: ['肛周', '臀部', '尾根'],
      symptoms: ['蹭屁股', '舔肛门', '肛周肿胀', '鱼腥臭', '排便疼痛', '肛门旁破溃', '坐地拖行']
    },
    typicalFeatures: '肛周不适、拖屁股、舔咬肛门，严重时肛门旁红肿、脓肿或破溃。',
    ddx: '与肛周瘘管区分：肛门囊病常以肛门囊堵塞、炎症或脓肿为主；肛周瘘管多为慢性多发瘘管和溃疡，德牧更常见。',
    urgency: 'moderate',
    redFlags: ['肛门旁脓肿破溃', '排便疼痛明显', '发热精神差']
  },
  {
    name: '蝇蛆病（伤口蛆症）',
    aliases: ['蝇蛆病', '伤口蛆症', 'myiasis'],
    species: ['犬', '猫'],
    category: 'parasite',
    keywords: {
      breeds: ['流浪动物', '长期卧床动物'],
      locations: ['伤口', '肛周', '会阴', '皮肤褶皱'],
      symptoms: ['伤口有虫', '蛆', '恶臭', '坏死', '流脓', '潮湿污染', '行动不便']
    },
    typicalFeatures: '污染或坏死伤口中可见蛆虫，常伴恶臭、渗出和局部组织损伤。',
    ddx: '与普通感染伤口区分：蝇蛆病可见活动蛆虫或虫体，提示需要尽快线下清创处理。',
    urgency: 'urgent',
    redFlags: ['大量蛆虫', '组织坏死', '精神食欲异常', '大面积污染伤口']
  },
  {
    name: '犬乳头状瘤病',
    aliases: ['乳头状瘤', '犬口腔乳头状瘤', 'papillomatosis'],
    species: ['犬'],
    category: 'mass',
    prevalence: 'uncommon',
    keywords: {
      breeds: ['幼犬', '免疫低下犬'],
      locations: ['口腔', '唇部', '眼睑', '皮肤'],
      symptoms: ['菜花样', '疣状增生', '多发小疙瘩', '表面粗糙', '年轻犬']
    },
    typicalFeatures: '年轻犬口腔或唇部多发菜花样、疣状增生物，多数为良性方向但需与恶性肿瘤鉴别。',
    ddx: '与鳞状细胞癌区分：乳头状瘤多见年轻犬且常多发疣状，鳞癌更常见老年动物、顽固破溃和进行性侵袭。',
    urgency: 'low',
    redFlags: ['影响进食', '持续增大破溃', '老年犬新发单个硬质肿块']
  },
  {
    name: '幼犬蜂窝织炎',
    aliases: ['幼犬蜂窝组织炎', '幼犬脓皮症样综合征', 'juvenile cellulitis'],
    species: ['犬'],
    category: 'rare_warning',
    keywords: {
      breeds: ['幼犬', '金毛', '腊肠', '比格'],
      locations: ['面部', '眼周', '耳部', '下颌淋巴结'],
      symptoms: ['幼犬脸肿', '眼周肿胀', '耳廓结痂', '脓疱结痂', '淋巴结肿大', '精神差', '发热']
    },
    typicalFeatures: '幼犬急性面部、眼周或耳部肿胀，伴脓疱结痂和下颌淋巴结肿大，可有全身不适。',
    ddx: '与普通脓皮病区分：幼犬蜂窝织炎常有急性面部肿胀和淋巴结肿大，不只是局部毛囊性丘疹脓疱。',
    urgency: 'urgent',
    redFlags: ['幼犬精神差', '发热', '面部明显肿胀', '进食困难']
  },
  {
    name: '盘状红斑狼疮',
    aliases: ['DLE', '鼻部狼疮', 'discoid lupus erythematosus'],
    species: ['犬'],
    category: 'rare_warning',
    keywords: {
      breeds: ['牧羊犬', '哈士奇', '牧羊犬系'],
      locations: ['鼻部', '鼻镜', '唇部', '眼周'],
      symptoms: ['鼻镜褪色', '鼻部结痂', '鼻部溃疡', '日晒加重', '色素脱失', '反复破溃']
    },
    typicalFeatures: '鼻镜或面部皮肤色素脱失、结痂和溃疡，日晒可能加重，属于需要检查确认的免疫介导方向。',
    ddx: '与日光性皮炎区分：两者都可日晒加重，盘状红斑狼疮更集中鼻镜色素脱失和慢性结痂溃疡，需病理鉴别。与锌反应性皮病区分：锌反应性更偏角化结痂和北欧犬种背景。',
    urgency: 'moderate',
    redFlags: ['鼻部持续溃疡', '出血不愈', '快速扩散']
  },
  {
    name: '红斑型天疱疮',
    aliases: ['pemphigus erythematosus', '面部天疱疮'],
    species: ['犬', '猫'],
    category: 'rare_warning',
    keywords: {
      breeds: ['牧羊犬', '柯利'],
      locations: ['面部', '鼻部', '耳部', '眼周'],
      symptoms: ['面部结痂', '脓疱', '鳞屑', '对称', '日晒加重', '鼻部脱色']
    },
    typicalFeatures: '面部、鼻部或耳部对称性结痂、鳞屑和浅表脓疱，兼有天疱疮和日晒相关表现的鉴别价值。',
    ddx: '与落叶型天疱疮区分：红斑型更偏面部和日晒部位，落叶型可更广泛扩散；两者均需细胞学和活检辅助确认。',
    urgency: 'moderate',
    redFlags: ['大范围糜烂', '精神食欲异常', '继发感染']
  },
  {
    name: '雪纳瑞粉刺综合征',
    aliases: ['雪纳瑞背部粉刺', 'schnauzer comedo syndrome'],
    species: ['犬'],
    category: 'rare_warning',
    keywords: {
      breeds: ['雪纳瑞'],
      locations: ['背部', '躯干背侧'],
      symptoms: ['背部黑头', '粉刺', '小丘疹', '皮屑', '反复结痂', '雪纳瑞']
    },
    typicalFeatures: '雪纳瑞背部多发黑头粉刺、丘疹和皮屑，可反复结痂或继发感染。',
    ddx: '与浅表脓皮病区分：雪纳瑞粉刺综合征有明显品种和背部黑头粉刺特征；若出现脓疱和渗出需考虑继发感染。',
    urgency: 'low'
  },
  {
    name: '睑炎',
    aliases: ['眼睑炎', 'blepharitis'],
    species: ['犬', '猫'],
    category: 'rare_warning',
    keywords: {
      breeds: ['短鼻犬', '扁脸猫'],
      locations: ['眼睑', '眼周', '面部'],
      symptoms: ['眼睑红肿', '眼周结痂', '眯眼', '流泪', '揉眼', '睫毛根部皮屑']
    },
    typicalFeatures: '眼睑边缘红肿、结痂、脱毛或分泌物，常伴揉眼、流泪或眯眼。',
    ddx: '与泪痕皮炎区分：睑炎主要在眼睑边缘红肿结痂，泪痕皮炎主要为眼下潮湿红褐色染色。眼部疼痛或角膜风险需要线下检查。',
    urgency: 'moderate',
    redFlags: ['眯眼明显', '角膜混浊', '眼部疼痛', '眼周快速肿胀']
  }
]

function mergeUniqueRaw(a, b) {
  var seen = {}
  var out = []
  var list = (a || []).concat(b || [])
  for (var i = 0; i < list.length; i++) {
    var item = list[i]
    if (!item || seen[item]) continue
    seen[item] = true
    out.push(item)
  }
  return out
}

function mergeKeywordsRaw(baseKeywords, extraKeywords) {
  baseKeywords = baseKeywords || { breeds: [], locations: [], symptoms: [] }
  extraKeywords = extraKeywords || {}
  return {
    breeds: mergeUniqueRaw(baseKeywords.breeds, extraKeywords.breeds),
    locations: mergeUniqueRaw(baseKeywords.locations, extraKeywords.locations),
    symptoms: mergeUniqueRaw(baseKeywords.symptoms, extraKeywords.symptoms)
  }
}

function mergeTextRaw(baseText, extraText) {
  if (!extraText) return baseText || ''
  if (!baseText) return extraText
  if (baseText.indexOf(extraText) >= 0) return baseText
  return baseText + ' ' + extraText
}

function maxUrgencyRaw(a, b) {
  var levels = { low: 0, moderate: 1, urgent: 2, emergency: 3 }
  return (levels[b] || 0) > (levels[a] || 0) ? b : a
}

function findDiseaseRaw(list, supplement) {
  var targetName = supplement.targetName || supplement.name
  for (var i = 0; i < list.length; i++) {
    var item = list[i]
    if (item.name === targetName || (item.aliases || []).indexOf(targetName) >= 0) return item
  }
  return null
}

function mergeDiseaseRaw(target, supplement) {
  target.aliases = mergeUniqueRaw(target.aliases, supplement.aliases)
  if (supplement.name && supplement.name !== target.name) target.aliases = mergeUniqueRaw(target.aliases, [supplement.name])
  target.species = mergeUniqueRaw(target.species, supplement.species)
  target.keywords = mergeKeywordsRaw(target.keywords, supplement.keywords)
  target.redFlags = mergeUniqueRaw(target.redFlags, supplement.redFlags)
  if (target.recommendedTests || supplement.recommendedTests) {
    target.recommendedTests = mergeUniqueRaw(target.recommendedTests, supplement.recommendedTests)
  }
  if (target.homeCareSafe || supplement.homeCareSafe) {
    target.homeCareSafe = mergeUniqueRaw(target.homeCareSafe, supplement.homeCareSafe)
  }
  target.typicalFeatures = mergeTextRaw(target.typicalFeatures, supplement.typicalFeatures)
  target.ddx = mergeTextRaw(target.ddx, supplement.ddx)
  target.urgency = maxUrgencyRaw(target.urgency || 'moderate', supplement.urgency || target.urgency)
  if (!target.category && supplement.category) target.category = supplement.category
  return target
}

function stripSupplementMeta(entry) {
  var out = {}
  var keys = Object.keys(entry)
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] === 'targetName') continue
    out[keys[i]] = entry[keys[i]]
  }
  return out
}

function mergeSupplementalDiseases(base, additions) {
  for (var i = 0; i < additions.length; i++) {
    var supplement = additions[i]
    var target = findDiseaseRaw(base, supplement)
    if (target) {
      mergeDiseaseRaw(target, supplement)
    } else {
      base.push(stripSupplementMeta(supplement))
    }
  }
  return base
}

DISEASE_KB = mergeSupplementalDiseases(DISEASE_KB, SUPPLEMENTAL_DISEASE_KB)

// ============================================================
// 检索函数
// ============================================================

var KB_VERSION = '2026-07-05'

/**
 * CHANGELOG:
 *
 * 2026-07-05 (v3):
 *   - 合并“常见皮肤病诊断.docx”的清洗版结构化补充
 *   - 增强热点、脓皮病、皮褶炎、马拉色菌、外耳炎、趾间炎等既有条目的关键词和鉴别
 *   - 新增脓疱病、犬痤疮、甲感染、耳血肿、肛门囊病、蝇蛆病、幼犬蜂窝织炎等细分条目
 *   - 处方剂量和疗程不进入面向用户报告，仅保留检查、红线和就医方向
 *
 * 2026-07-01 (v2):
 *   - 疾病条目从 50 种扩展至 53 种
 *   - 新增：猫甲状腺功能亢进相关皮肤改变、猫过敏性皮炎（非跳蚤非食物）、全身型蠕形螨病
 *   - 原“蠕形螨病”拆分为局灶型和全身型，临床意义更清晰
 *   - 补充多个条目的好发品种数据（跳蚤过敏、疥螨、猫粟粒性皮炎、猫痤疮等）
 *   - 新增 relatedDiseases 结构化关联字段，记录疾病上下游关系
 *   - 改进 buildDifferentials：支持从 ddx 字段提取多组鉴别诊断
 *   - 为 inferCategory 添加优先级设计文档注释
 *
 * 2026-06-28 (v1): 初始版本，50 种疾病
 */

var SOURCE_LIBRARY = {
  allergy: [
    { title: 'AAHA 2023 Allergic Skin Diseases in Dogs and Cats Guidelines', url: 'https://www.aaha.org/resources/2023-aaha-management-of-allergic-skin-diseases-in-dogs-and-cats-guidelines/', tier: 'guideline' },
    { title: 'Merck Veterinary Manual - Diagnosis of Skin Diseases in Small Animals', url: 'https://www.merckvetmanual.com/integumentary-system/integumentary-system-introduction/diagnosis-of-skin-diseases-in-small-animals', tier: 'manual' }
  ],
  parasite: [
    { title: 'Merck Veterinary Manual - Mange in Dogs and Cats', url: 'https://www.merckvetmanual.com/integumentary-system/mange/mange-in-dogs-and-cats', tier: 'manual' },
    { title: 'ACVD Clinical Consensus Guidelines', url: 'https://acvd.org/about-us/clinical-consensus-guidelines/', tier: 'consensus' }
  ],
  bacterial: [
    { title: 'Merck Veterinary Manual - Pyoderma in Dogs and Cats', url: 'https://www.merckvetmanual.com/integumentary-system/pyoderma/pyoderma-in-dogs-and-cats', tier: 'manual' },
    { title: 'WAVD Consensus Guidelines', url: 'https://wavd.org/continuing-education/consensus-guidelines/', tier: 'consensus' }
  ],
  fungal: [
    { title: 'Merck Veterinary Manual - Dermatophytosis in Dogs and Cats', url: 'https://www.merckvetmanual.com/integumentary-system/dermatophytosis/dermatophytosis-in-dogs-and-cats', tier: 'manual' },
    { title: 'WAVD Consensus Guidelines', url: 'https://wavd.org/continuing-education/consensus-guidelines/', tier: 'consensus' }
  ],
  yeast: [
    { title: 'Merck Veterinary Manual - Dermatological Problems in Animals', url: 'https://www.merckvetmanual.com/integumentary-system/integumentary-system-introduction/dermatological-problems-in-animals', tier: 'manual' },
    { title: 'ACVD Clinical Consensus Guidelines', url: 'https://acvd.org/about-us/clinical-consensus-guidelines/', tier: 'consensus' }
  ],
  ear: [
    { title: 'Merck Veterinary Manual - Otitis Externa in Animals', url: 'https://www.merckvetmanual.com/ear-disorders/otitis-externa/otitis-externa-in-animals', tier: 'manual' }
  ],
  paw: [
    { title: 'Merck Veterinary Manual - Diagnosis of Skin Diseases in Small Animals', url: 'https://www.merckvetmanual.com/integumentary-system/integumentary-system-introduction/diagnosis-of-skin-diseases-in-small-animals', tier: 'manual' }
  ],
  feline: [
    { title: 'Merck Veterinary Manual - Skin Disorders of Cats', url: 'https://www.merckvetmanual.com/cat-owners/skin-disorders-of-cats', tier: 'manual' }
  ],
  mass: [
    { title: 'Merck Veterinary Manual - Tumors of the Skin in Dogs', url: 'https://www.merckvetmanual.com/dog-owners/skin-disorders-of-dogs/tumors-of-the-skin-in-dogs', tier: 'manual' },
    { title: 'Merck Veterinary Manual - Tumors of the Skin in Cats', url: 'https://www.merckvetmanual.com/cat-owners/skin-disorders-of-cats/tumors-of-the-skin-in-cats', tier: 'manual' }
  ],
  rare_warning: [
    { title: 'Merck Veterinary Manual - Diagnosis of Skin Diseases in Small Animals', url: 'https://www.merckvetmanual.com/integumentary-system/integumentary-system-introduction/diagnosis-of-skin-diseases-in-small-animals', tier: 'manual' }
  ]
}

var CATEGORY_TESTS = {
  allergy: ['跳蚤梳检和驱虫史复核', '皮肤刮片排除螨虫', '皮肤细胞学检查继发感染', '食物排除试验或环境过敏评估'],
  parasite: ['皮肤刮片或胶带检查', '跳蚤梳检/耳垢镜检', '驱虫史和同住动物检查', '必要时治疗性试验'],
  bacterial: ['皮肤细胞学检查', '细菌培养和药敏（反复或深部病变）', '皮肤刮片排除螨虫', '评估过敏或内分泌等基础病'],
  fungal: ['伍德灯检查', '真菌培养或PCR', '毛发镜检', '皮肤刮片排除螨虫'],
  yeast: ['皮肤或耳道细胞学检查', '耳镜检查', '评估过敏、褶皱潮湿或基础病', '必要时细菌培养'],
  ear: ['耳镜检查', '耳垢显微镜检查', '耳道细胞学检查', '必要时细菌培养和药敏'],
  paw: ['趾间细胞学检查', '皮肤刮片', '异物/外伤检查', '反复病例评估过敏和足部结构'],
  feline: ['跳蚤梳检', '真菌培养或PCR', '皮肤细胞学检查', '必要时活检或排除过敏'],
  mass: ['细针抽吸细胞学', '活检/病理检查', '测量并记录大小变化', '评估区域淋巴结和全身状态'],
  rare_warning: ['皮肤细胞学检查', '皮肤刮片和真菌检查', '活检/病理检查', '基础病筛查']
}

var CATEGORY_HOME_CARE = {
  allergy: ['记录瘙痒、舔咬和发作时间', '避免反复抓挠舔咬', '按兽医建议做好跳蚤预防', '不要自行混用人用止痒药或激素药膏'],
  parasite: ['同住动物一起观察', '清洗垫子和常接触织物', '避免徒手挤压或强行拔除不明皮损', '疑似传染性寄生虫时减少密切接触'],
  bacterial: ['保持患处清洁干燥', '避免舔咬和抓挠扩大破损', '不要自行使用抗生素或人用药膏', '记录是否有渗出、脓液或疼痛'],
  fungal: ['减少与儿童、老人和免疫低下者密切接触', '清洗环境织物', '不要自行混用人用抗真菌药', '多宠家庭同步观察'],
  yeast: ['保持褶皱、爪缝或耳周干燥', '不要向耳道内自行滴不明药水', '记录异味和分泌物颜色', '避免反复潮湿闷热'],
  ear: ['不要深入掏耳或使用尖锐工具', '记录甩头、抓耳和分泌物颜色', '多宠家庭观察是否同时抓耳', '避免自行滴不明耳药'],
  paw: ['减少舔爪', '散步后擦干爪缝', '观察是否跛行或单侧疼痛', '不要挤压趾间结节'],
  feline: ['减少应激并记录过度舔毛', '检查跳蚤和同住动物情况', '避免自行剃毛或涂刺激性药膏', '若人也有皮损应减少接触并就医咨询'],
  mass: ['拍照并测量肿块大小', '不要挤压、挑破或热敷肿块', '记录是否增大、出血或破溃', '尽快预约线下检查'],
  rare_warning: ['记录范围和扩散速度', '避免自行上药掩盖病变', '若破溃、疼痛或精神食欲异常应尽快就医', '准备既往用药和病史给兽医']
}

// ============================================================
// 受控词表（单一数据源）
// 原则：视觉词表 = 图片能直接看到的形态学特征
//       病史词表 = 图片看不到、只能靠问诊/主诉获得（行为、感受、气味、病程、全身症状、环境诱因）
// 视觉提取 prompt 和知识库检索共用 VISUAL_VOCAB，两端严格对齐
// ============================================================

// 视觉可见特征（模型看图能报告的）— 按语义分组，便于维护
var VISUAL_VOCAB_GROUPS = {
  毛发: ['脱毛', '圆形脱毛', '局灶脱毛', '对称脱毛', '断毛', '毛发稀疏', '毛发粗乱', '毛发粘连', '短毛', '虫蛀样脱毛'],
  颜色: ['红斑', '红肿', '发红', '充血', '色素沉着', '黑色', '白色', '红褐', '蓝灰', '紫', '变色', '黑褐色', '黄褐色', '色素脱失', '皮肤发黑', '甲沟红肿', '红肿发热', '毛发发红变色', '黑皮', '鼻镜褪色', '鼻部脱色', '眼睑红肿'],
  鳞屑结痂: ['鳞屑', '皮屑', '大量皮屑', '结痂', '表皮环', '厚痂', '分层脱屑', '脓疱结痂', '薄黄痂', '环形鳞屑脱毛斑', '耳廓结痂', '鼻部结痂', '面部结痂', '眼周结痂'],
  丘疹脓疱: ['丘疹', '脓疱', '粟粒', '红疹', '小米粒', '水疱', '黑头', '粉刺', '黑点', '黑色颗粒', '小水泡', '黑头粉刺', '小丘疹', '多发小疙瘩', '毛囊中心红点', '小红疙瘩', '薄壁脓疱', '下巴黑点', '颏部脓疱', '下巴起疙瘩', '背部黑头'],
  渗出分泌: ['渗出', '潮湿', '湿润', '分泌物', '脓性', '流脓', '化脓', '蜡样', '油腻', '耳垢', '脓液', '渗液', '蜡质油腻', '黄绿色分泌物', '化脓性分泌物', '浸渍', '油腻皮屑', '淡黄色浆液', '皮肤渗水', '流脓血', '爪部渗脓', '有臭味分泌物', '破溃流脓', '脓腔', '潮湿污染', '趾甲渗脓', '褶皱内积污', '浑浊'],
  破损溃疡: ['破溃', '溃疡', '糜烂', '破损', '撕裂', '裂纹', '干裂', '伤口', '出血', '擦伤', '破皮', '深层溃疡', '坏死', '穿刺伤', '发红破皮', '耳道溃疡', '肛门旁破溃', '鼻部溃疡'],
  增厚质地: ['增厚', '增生', '角化', '硬皮', '粗糙', '硬结', '硬化', '皮肤变薄', '钙化', '皮肤苔藓化', '疣状增生', '表面粗糙', '指甲变厚', '指甲发白', '指甲发黄', '指甲变形'],
  肿物: ['肿块', '结节', '隆起', '囊性', '肿胀', '波动', '皮下硬块', '淋巴结肿大', '菜花样', '波动感', '突然肿包', '耳朵鼓包', '耳廓肿胀', '耳朵像气球', '肛周肿胀', '幼犬脸肿', '眼周肿胀', '耳道红肿', '脚趾间反复红肿', '淋巴结增大'],
  特殊结构: ['瘘管', '肉垫', '脚垫', '泪痕', '甲床感染', '指甲松动', '睫毛根部皮屑'],
  可见寄生虫: ['虫体', '虱卵', '伤口有虫', '蛆'],
  分布形态: ['环形', '对称', '多发', '局灶']
}
// 注：黏膜相关词由 MUCOSAL_TERMS 处理，不在此视觉词表中

// 拍平成一维视觉词表
var VISUAL_VOCAB = (function () {
  var out = []
  var keys = Object.keys(VISUAL_VOCAB_GROUPS)
  for (var i = 0; i < keys.length; i++) {
    out = out.concat(VISUAL_VOCAB_GROUPS[keys[i]])
  }
  return out
})()

// 病史/问诊词（图片看不到，靠用户描述或体检获得）
var HISTORY_VOCAB = [
  // 病程
  '慢性', '反复', '急性', '突然', '季节性', '全年', '经常',
  // 感受/程度
  '瘙痒', '剧烈瘙痒', '不痒', '轻痒', '无瘙痒', '轻度瘙痒', '疼痛', '热痛', '无痛', '不痛', '跛行',
  // 病程/转归
  '不愈', '顽固', '快速扩大', '慢性迁延', '一夜烂一块',
  // 行为（静态图不可见）
  '舔舐', '舔爪', '舔毛', '过度舔', '搔抓', '抓挠', '挠', '甩头', '抓耳', '舔咬',
  '疯狂抓挠', '舔咬患肢', '舔咬爪子', '啃玩具后加重', '蹭屁股', '舔肛门', '坐地拖行', '眯眼', '揉眼',
  // 气味
  '异味', '臭味', '酸腐味', '酸臭味', '腐臭味', '褶皱臭', '鱼腥臭', '恶臭',
  // 传播/环境诱因
  '传染', '传染人', '人也有', '人也痒', '多宠', '幼宠', '户外', '草丛', '夏天',
  '接触', '地面', '清洁剂', '植物', '摩擦', '压力点', '注射', '疫苗', '咬伤', '外伤', '抓伤',
  '跳蚤', '虫', '叮咬', '蚊', '蜂', '晒', '日晒加重',
  // 全身症状
  '多饮多尿', '体重下降', '乏力', '肥胖', '精神食欲异常', '嗜睡', '腹泻', '呕吐',
  '胃肠', '便秘', '便血', '排便困难', '排便疼痛', '腹部膨大', '贫血', '继发感染', '耳炎', '流泪',
  '发热', '精神差', '行动不便',
  // 疼痛/触感
  '碰就疼', '耳道疼痛', '触碰疼痛', '局部热痛', '皮肤发热', '趾甲疼痛', '单爪疼痛',
  // 年龄/性别
  '幼犬', '老年', '公猫', '压力', '焦虑', '低龄幼犬', '未满6月龄', '年轻犬', '雪纳瑞',
  // 发作模式
  '结痂反复', '反复耳炎', '反复破溃', '反复结痂', '无明显化脓', '不怎么挠'
]

var VISUAL_VOCAB_SET = {}
VISUAL_VOCAB.forEach(function (w) { VISUAL_VOCAB_SET[w] = true })
var HISTORY_VOCAB_SET = {}
HISTORY_VOCAB.forEach(function (w) { HISTORY_VOCAB_SET[w] = true })

// 变体词 → 标准视觉词映射（解决"疾病用复合词、模型输出标准词导致 indexOf 匹配不上"的漏检）
var SIGN_NORMALIZE = {
  '大面积脱毛': '脱毛', '尾巴脱毛': '脱毛', '皮肤增厚': '增厚', '色素': '色素沉着',
  '肿': '肿块', '包': '肿块', '突起': '隆起', '薄': '皮肤变薄', '脆弱': '皮肤变薄',
  '裂开': '裂纹', '脓': '脓疱', '领圈': '结痂', '毛囊': '丘疹', '引流': '瘘管',
  '硬': '硬结', '附着': '虫体', '晒斑': '红斑'
}

// 部位词（误入 symptoms，实际由 locations 匹配，从视觉词里剔除避免污染）
var LOCATION_IN_SYMPTOMS = {
  '耳尖': true, '面部': true, '鼻部': true, '唇部': true, '腹股沟': true,
  '下巴': true, '褶皱': true, '尾根': true, '皱褶': true, '眼': true, '眼周': true, '趾间': true
}

// 纯描述性/无检索价值的词（剔除）
var NOISE_SIGNS = { '内容物': true, '增大': true, '不定': true, '脏': true }

/**
 * 规范化一个症状词：变体归并到标准词，部位/噪声词返回 null（剔除）
 */
function normalizeSign(sign) {
  if (LOCATION_IN_SYMPTOMS[sign] || NOISE_SIGNS[sign]) return null
  return SIGN_NORMALIZE[sign] || sign
}

/**
 * 把一个症状词分类到视觉/病史
 * 优先级：明确病史词 → 病史；其余 → 视觉（保守默认，避免视觉词遗漏）
 */
function classifySign(sign) {
  if (HISTORY_VOCAB_SET[sign]) return 'history'
  return 'visual'
}

var GENERIC_VISUAL_SIGNS = ['红肿', '脱毛', '瘙痒', '结痂', '红斑', '皮屑', '鳞屑', '抓挠', '舔舐', '发红']
var RED_FLAG_TERMS = ['快速扩大', '大面积破溃', '流脓', '明显疼痛', '精神食欲异常', '不愈', '出血', '呼吸困难', '面部肿胀', '幼猫严重感染', '人也出现皮损']
var RAG_PROMPT_MIN_SCORE = 6
var MUCOSAL_TERMS = ['口腔', '口内', '嘴里', '嘴巴里面', '牙龈', '舌', '舌头', '口唇内侧', '黏膜', '粘膜', 'oral', 'mouth', 'gum', 'tongue', 'mucosa']

/**
 * negativeSignals：如果搜索文本中包含这些词，对该疾病扣分
 * 用于排除明显不符合的候选（如蠕形螨不痒但用户描述剧痒）
 */
var NEGATIVE_SIGNALS = {
  '蠕形螨病（局灶型）': ['剧烈瘙痒', '剧痒', '特别痒', '痒死了', '传染人'],
  '全身型蠕形螨病': ['剧烈瘙痒', '剧痒', '特别痒', '传染人'],
  '猫心理性脱毛': ['红斑', '脓疱', '结痂', '鳞屑', '渗出', '溃疡', '传染人'],
  '甲状腺功能减退相关皮肤改变': ['剧烈瘙痒', '急性', '突然', '丘疹', '脓疱', '传染人'],
  '库兴综合征相关皮肤改变': ['剧烈瘙痒', '急性', '突然', '脓疱', '传染人'],
  '皮脂腺囊肿': ['瘙痒', '红斑', '脱毛', '鳞屑', '渗出', '传染人'],
  '肢端舔舐性肉芽肿': ['急性', '突然', '多发', '全身', '传染人'],
  '压力性胼胝/肘部胼胝': ['瘙痒', '脓疱', '渗出', '急性', '传染人'],
  '猫注射部位肉瘤': ['瘙痒', '鳞屑', '脱毛', '对称', '传染人'],
  '急性湿性皮炎（热点）': ['慢性', '反复', '对称', '不痒', '圆形脱毛'],
  '跳蚤过敏性皮炎': ['不痒', '无瘙痒', '肿块', '结节'],
  '疥螨病': ['不痒', '无瘙痒', '油腻', '肿块']
}

function uniq(list) {
  var seen = {}
  var out = []
  for (var i = 0; i < (list || []).length; i++) {
    var item = list[i]
    if (!item || seen[item]) continue
    seen[item] = true
    out.push(item)
  }
  return out
}

/**
 * 根据疾病名称和别名推断疾病分类
 *
 * 判断优先级设计说明（从高到低）：
 *   1. ear        - 耳部疾病优先，因为耳病有独特的检查和处理流程
 *   2. parasite   - 寄生虫类次之，因为蜱虫、蠕形螨、疥螨、跳蚤、虱等均有独立诊疗路径
 *   3. bacterial  - 细菌性感染，处理流程相对统一
 *   4. fungal     - 真菌感染，传染性和公共卫生意义优先
 *   5. yeast      - 马拉色菌等酵母菌，与细菌性处理流程不同
 *   6. allergy    - 过敏类，排除性诊断流程
 *   7. paw        - 爪部疾病，解剖位置和护理特殊
 *   8. mass       - 肿块/肿瘤，需要活检确诊
 *   9. feline     - 纯猫种专属疾病（仅当上述均不匹配且 species=['\u732b'] 时）
 *  10. rare_warning - 兆底分类
 *
 * 注意：耳部相关疾病（如马拉色菌性外耳炎、耳螨）归入 ear 而非 yeast/parasite，
 * 因为耳病有独特的耳镜和耳垢检查流程。马拉色菌皮炎（无耳炎）仍归入 yeast。
 */
function inferCategory(entry) {
  if (entry.category) return entry.category
  var text = [entry.name].concat(entry.aliases || []).join(' ').toLowerCase()
  if (text.indexOf('耳') >= 0 || text.indexOf('otitis') >= 0 || text.indexOf('ear') >= 0 || text.indexOf('otodectes') >= 0) return 'ear'
  if (text.indexOf('跳蚤') >= 0 || text.indexOf('螨') >= 0 || text.indexOf('蜱') >= 0 || text.indexOf('虱') >= 0 || text.indexOf('虫') >= 0 || text.indexOf('mange') >= 0 || text.indexOf('mite') >= 0 || text.indexOf('lice') >= 0 || text.indexOf('pediculosis') >= 0) return 'parasite'
  if (text.indexOf('脓') >= 0 || text.indexOf('细菌') >= 0 || text.indexOf('pyoderma') >= 0 || text.indexOf('folliculitis') >= 0) return 'bacterial'
  if (text.indexOf('癣') >= 0 || text.indexOf('真菌') >= 0 || text.indexOf('ringworm') >= 0 || text.indexOf('dermatophytosis') >= 0) return 'fungal'
  if (text.indexOf('马拉色') >= 0 || text.indexOf('酵母') >= 0 || text.indexOf('malassezia') >= 0) return 'yeast'
  if (text.indexOf('过敏') >= 0 || text.indexOf('特应') >= 0 || text.indexOf('接触') >= 0 || text.indexOf('allergy') >= 0 || text.indexOf('atopic') >= 0) return 'allergy'
  if (text.indexOf('趾间') >= 0 || text.indexOf('足') >= 0 || text.indexOf('爪') >= 0 || text.indexOf('pododermatitis') >= 0) return 'paw'
  if (text.indexOf('肿瘤') >= 0 || text.indexOf('癌') >= 0 || text.indexOf('肉瘤') >= 0 || text.indexOf('囊肿') >= 0 || text.indexOf('tumor') >= 0 || text.indexOf('carcinoma') >= 0 || text.indexOf('sarcoma') >= 0 || text.indexOf('cyst') >= 0) return 'mass'
  if ((entry.species || []).length === 1 && entry.species[0] === '猫') return 'feline'
  return 'rare_warning'
}

function makeId(entry, index) {
  var english = ''
  for (var i = 0; i < (entry.aliases || []).length; i++) {
    if (/^[a-z0-9 -]+$/i.test(entry.aliases[i])) {
      english = entry.aliases[i].toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      break
    }
  }
  return (english || ('clinical_card_' + (index + 1))) + '_' + (entry.species || []).join('_')
}

function inferBaselinePriority(entry, category) {
  var name = entry.name

  // ── 优先级 5：高发常见病（临床就诊量最大）──
  var HIGH_PREVALENCE = [
    '浅表脓皮病',
    '特应性皮炎（环境过敏）',
    '跳蚤过敏性皮炎',
    '马拉色菌皮炎',
    '皮肤癣菌病（犬猫）',
    '耳螨感染',
    '急性湿性皮炎（热点）',
    '猫粟粒性皮炎（跳蚤过敏）',
    '猫浅表脓皮病'
  ]
  if (HIGH_PREVALENCE.indexOf(name) >= 0) return 5

  // ── 优先级 4：较常见病 ──
  var MODERATE_PREVALENCE = [
    '蠕形螨病（局灶型）',
    '全身型蠕形螨病',
    '疥螨病',
    '食物过敏性皮炎',
    '深部脓皮病',
    '趾间脓皮病（趾间炎）',
    '皮脂溢性皮炎',
    '皮肤褶皱皮炎',
    '接触性皮炎',
    '毛囊炎',
    '猫痤疮',
    '嗜酸性肉芽肿复合体',
    '猫过敏性皮炎（非跳蚤非食物）',
    '猫蠕形螨病',
    '猫疥螨病',
    '马拉色菌性外耳炎',
    '细菌性外耳炎',
    '蜱虫叮咬',
    '蚊虫叮咬/昆虫过敏',
    '姬螯螨病（行走的皮屑）',
    '脓疱病',
    '下颏脓皮病（犬痤疮）',
    '脓肿/蜂窝织炎',
    '耳血肿'
  ]
  if (MODERATE_PREVALENCE.indexOf(name) >= 0) return 4

  // ── 优先级 3：不常见（仍有临床意义）──
  if (category === 'allergy' || category === 'bacterial' || category === 'parasite' || category === 'ear' || category === 'yeast') return 3

  // ── 优先级 2：罕见/低频（肿瘤、免疫介导、内分泌、遗传性等）──
  // 注意：urgency 字段独立控制报告紧急度，不影响搜索排名
  return 2
}

function inferPrevalence(priority, category) {
  if (priority >= 4) return 'common'
  if (category === 'mass' || category === 'rare_warning') return 'low_frequency_warning'
  if (priority === 3) return 'uncommon'
  return 'low_frequency_warning'
}

/**
 * 从 ddx 字段提取多组鉴别诊断条目
 * ddx 格式约定：每组以"与XX区分：说明"开头，组间用分号或句号分隔
 */
function buildDifferentials(entry) {
  if (!entry.ddx) return []
  var results = []
  // 按分号或句号分割，取包含"与...区分"的片段
  var parts = entry.ddx.split(/[\uff1b\u3002\u003b]/)
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i].trim()
    if (!part) continue
    var match = part.match(/\u4e0e(.+?)\u533a\u5206[:\uff1a](.*)/)
    if (match) {
      var name = match[1].trim()
      var distinguish = match[2] ? match[2].trim() : part
      results.push({ name: name, distinguish: name + '\uff1a' + distinguish })
    } else if (results.length === 0) {
      // 无匹配模式时，整条作为单个鉴别条目
      var fallbackName = '\u76f8\u4f3c\u76ae\u80a4\u95ee\u9898'
      var fbMatch = part.match(/\u4e0e(.+?)\u533a\u5206/)
      if (fbMatch) fallbackName = fbMatch[1].trim()
      results.push({ name: fallbackName, distinguish: part })
    }
  }
  return results.length ? results : [{ name: '\u76f8\u4f3c\u76ae\u80a4\u95ee\u9898', distinguish: entry.ddx }]
}

function buildVetAdvice(entry, category) {
  if (category === 'mass') return '出现持续增大、破溃、不愈合或位置异常的肿块时，建议线下兽医做细针抽吸或活检评估。'
  if (entry.urgency === 'urgent' || entry.urgency === 'emergency') return '该方向存在较高就医必要性，建议尽快线下检查确认。'
  if (category === 'fungal') return '疑似传染性真菌或多宠家庭病例，建议线下检查确认后再处理。'
  if (category === 'ear') return '耳道问题建议通过耳镜和耳垢/细胞学检查确认，避免自行深入清理。'
  return '若皮损扩散、破溃渗出、持续瘙痒或反复发作，建议线下兽医检查确认。'
}

function displayDiseaseName(entry, species) {
  if (entry.name === '皮肤癣菌病（犬猫）') {
    if (species === '猫') return '猫癣'
    if (species === '犬') return '犬癣'
    return '皮肤癣菌病'
  }
  return entry.name
}

function toClinicalCard(entry, index) {
  var category = inferCategory(entry)
  var priority = inferBaselinePriority(entry, category)

  // 按受控词表把 keywords.symptoms 分流到视觉 / 病史（先规范化变体词）
  var symptoms = (entry.keywords && entry.keywords.symptoms) || []
  var visualFromSymptoms = []
  var historyFromSymptoms = []
  for (var s = 0; s < symptoms.length; s++) {
    var norm = normalizeSign(symptoms[s])
    if (!norm) continue // 部位/噪声词剔除
    if (classifySign(norm) === 'history') historyFromSymptoms.push(norm)
    else visualFromSymptoms.push(norm)
  }

  var visualSigns = uniq((entry.visualSigns || []).concat(visualFromSymptoms))
  var historySigns = uniq((entry.historySigns || []).concat(historyFromSymptoms).concat(
    (entry.keywords && entry.keywords.breeds && entry.keywords.breeds.length ? ['易感品种'] : []),
    category === 'fungal' ? ['幼年或新宠接触', '多宠家庭', '人也有皮损'] : [],
    category === 'parasite' ? ['户外活动', '同住动物瘙痒', '驱虫不规律'] : [],
    category === 'allergy' ? ['反复发作', '季节性或全年性瘙痒', '既往过敏史'] : [],
    category === 'ear' ? ['频繁甩头或抓耳', '耳道分泌物增多'] : []
  ))
  var redFlags = uniq((entry.redFlags || []).concat(
    category === 'mass' ? ['持续增大', '破溃不愈', '出血', '快速变化'] : [],
    entry.urgency === 'urgent' ? ['明显疼痛', '流脓', '范围快速扩大'] : [],
    category === 'fungal' ? ['人也出现皮损', '幼猫严重感染'] : [],
    ['精神食欲异常', '大面积破溃']
  ))

  return {
    id: entry.id || makeId(entry, index),
    name: entry.name,
    aliases: entry.aliases || [],
    species: entry.species || [],
    category: category,
    prevalence: inferPrevalence(priority, category),
    baselinePriority: priority,
    visualSigns: visualSigns,
    historySigns: historySigns,
    locations: (entry.keywords && entry.keywords.locations) || entry.locations || [],
    breeds: (entry.keywords && entry.keywords.breeds) || entry.breeds || [],
    typicalFeatures: entry.typicalFeatures || '',
    keyDifferentials: entry.keyDifferentials || buildDifferentials(entry),
    recommendedTests: entry.recommendedTests || CATEGORY_TESTS[category] || CATEGORY_TESTS.rare_warning,
    homeCareSafe: entry.homeCareSafe || CATEGORY_HOME_CARE[category] || CATEGORY_HOME_CARE.rare_warning,
    vetAdvice: entry.vetAdvice || buildVetAdvice(entry, category),
    redFlags: redFlags,
    urgency: entry.urgency || 'moderate',
    report: entry.report || {
      possibleDirection: '照片表现可将“' + entry.name + '”作为候选鉴别方向之一。',
      evidenceTemplate: '支持点包括：{matchedSigns}。',
      uncertainty: '单靠照片不能确诊，需要结合病史、体检和必要的实验室检查。'
    },
    sources: entry.sources || SOURCE_LIBRARY[category] || SOURCE_LIBRARY.rare_warning,
    reviewStatus: entry.reviewStatus || 'draft',
    version: entry.version || KB_VERSION,
    keywords: entry.keywords || { breeds: [], locations: [], symptoms: [] },
    ddx: entry.ddx || '',
    relatedDiseases: entry.relatedDiseases || []
  }
}

DISEASE_KB = DISEASE_KB.map(toClinicalCard)

function expandQueryTerms(text) {
  var source = String(text || '').toLowerCase()
  if (!source) return ''

  var extra = []
  var groups = [
    { terms: ['掉毛', '秃毛', '秃了一块', '毛少', '毛稀', '脱发', '毛变少', '毛掉了很多', '秃一片', '光秃', '稀稀拉拉', '毛没了', '长不出毛', '掉了一片毛', '毛越来越少'], add: ['脱毛'] },
    { terms: ['圆斑', '圆形斑', '圆圈', '圆形', '环形', '环形脱毛', '圆形掉毛', '圆形秃毛', '边界清楚', '一圈一圈', '圆圆的秃了', '像铜钱', '像硬币'], add: ['圆形脱毛'] },
    { terms: ['单片', '一块', '局部一块', '局灶性', '就一小块', '只有一个地方'], add: ['局灶'] },
    { terms: ['皮屑', '白屑', '碎屑', '屑', '一层白的', '白色粉末', '头皮屑一样'], add: ['鳞屑'] },
    { terms: ['痂皮', '硬痂', '结壳', '结疤', '一层硬的', '结了痂', '干了的血'], add: ['结痂'] },
    { terms: ['毛断', '断裂毛', '毛发折断', '断毛发', '毛一截截', '毛齐齐断了'], add: ['断毛'] },
    { terms: ['泛红', '发红', '红色', '发炎', '红红的', '皮肤红', '一片红', '又红又肿'], add: ['红斑', '红肿'] },
    { terms: ['流液', '渗液', '渗水', '流水', '湿的', '湿润', '湿湿的', '黏糊糊', '总是湿的', '渗黄水'], add: ['渗出', '潮湿'] },
    { terms: ['鼓包', '包块', '疙瘩', '肉疙瘩', '隆起', '摸着一个包', '长了个东西', '凸起来', '硬块', '软包', '皮下有东西'], add: ['肿块', '结节'] },
    { terms: ['破了', '破皮', '烂了', '溃烂', '烂掉了', '皮肤破了', '有伤口', '开放性', '一直不好'], add: ['破溃', '溃疡'] },
    { terms: ['黄色分泌物', '脓液', '有脓', '化脓', '黄绿色', '挤出来', '流脓水', '脓包'], add: ['流脓', '脓', '脓疱'] },
    { terms: ['舔咬', '一直舔', '频繁舔', '不停舔', '舔红了', '疯狂舔', '啃咬'], add: ['舔舐', '舔爪'] },
    { terms: ['抓', '挠', '抓挠', '使劲挠', '挠破了', '挠出血'], add: ['搔抓', '瘙痒'] },
    { terms: ['臭味', '酸臭', '霉味', '味道很重', '臭臭的', '腥臭', '有味道', '闻到味', '很臭', '发霉味', '发酵味'], add: ['异味'] },
    { terms: ['黑点', '黑色颗粒', '黑色小点', '像黑芝麻'], add: ['黑色颗粒'] },
    { terms: ['会传染', '人也长', '人也痒', '家人也开始', '小孩也有'], add: ['传染人'] },
    // ── 瘙痒口语 ──
    { terms: ['好痒', '痒死了', '老挠', '一直挠', '使劲挠', '蹭墙', '蹭地板', '烦躁抓', '抓个不停', '停不下来挠', '痒得不行', '整天在挠', '睡不着挠', '挠得厉害'], add: ['剧烈瘙痒', '搔抓', '瘙痒'] },
    // ── 耳朵相关 ──
    { terms: ['耳朵臭', '耳朵里有东西', '耳朵痒', '甩头', '抓耳朵', '耳垢多', '耳朵分泌物', '耳道堵', '耳朵黑', '耳朵脏', '耳朵里面脏脏的', '耳朵有味', '耳朵红', '耳朵肿', '挠耳朵', '歪头'], add: ['耳垢', '异味', '搔抓'] },
    // ── 皮肤增厚/变色 ──
    { terms: ['皮肤变厚', '皮变厚', '增生了', '皮变粗', '角质感', '老茧感', '皮肤硬了', '像大象皮', '粗糙'], add: ['增厚', '色素沉着'] },
    { terms: ['皮肤黑了', '变黑', '发黑', '颜色变深', '黑色素沉着', '黑一块', '越来越黑'], add: ['色素沉着', '黑色'] },
    // ── 新增：反复/慢性 ──
    { terms: ['反反复复', '老是犯', '总是好不了', '治了又犯', '好了又来', '经常发作', '每年都有', '春天就犯', '换季就'], add: ['反复', '慢性', '季节性'] },
    // ── 新增：肿胀 ──
    { terms: ['肿了', '肿起来', '鼓起来', '胀', '浮肿', '水肿', '又肿又红'], add: ['肿胀', '红肿'] },
    // ── 新增：出血 ──
    { terms: ['出血', '流血', '血', '有血', '带血', '血淋淋'], add: ['出血', '破溃'] },
    // ── 新增：脓疱/丘疹 ──
    { terms: ['小红点', '小红疙瘩', '一粒粒', '密密麻麻的点', '像痘痘', '起了好多小包', '小白点'], add: ['丘疹', '脓疱'] },
    // ── 新增：油腻 ──
    { terms: ['油油的', '很油', '毛发油腻', '总是油', '油光', '腻腻的'], add: ['油腻'] },
    // ── 新增：对称性 ──
    { terms: ['两边都有', '对称', '左右一样', '两侧', '双侧'], add: ['对称'] },
    // ── 新增：跛行/疼痛 ──
    { terms: ['不让碰', '一碰就叫', '疼', '痛', '跛', '瘸了', '抬脚', '走路一瘸一拐'], add: ['疼痛', '跛行'] },
    // ── 新增：食欲/精神 ──
    { terms: ['不吃饭', '没精神', '蔫了', '不活泼', '嗜睡', '没食欲', '吃得少'], add: ['精神食欲异常'] }
  ]

  for (var i = 0; i < groups.length; i++) {
    for (var j = 0; j < groups[i].terms.length; j++) {
      if (source.indexOf(groups[i].terms[j]) >= 0) {
        extra = extra.concat(groups[i].add)
        break
      }
    }
  }

  return [source].concat(extra).join(' ')
}

function hasAny(text, terms) {
  for (var i = 0; i < terms.length; i++) {
    if (text.indexOf(terms[i]) >= 0) return true
  }
  return false
}

function isMucosalQuery(bodyPart, searchText) {
  var text = String(bodyPart || '').toLowerCase() + ' ' + String(searchText || '').toLowerCase()
  return hasAny(text, MUCOSAL_TERMS)
}

function diseaseSupportsMucosalLocation(disease) {
  var text = [
    disease.name || '',
    (disease.aliases || []).join(' '),
    (disease.locations || []).join(' ')
  ].join(' ').toLowerCase()
  return hasAny(text, MUCOSAL_TERMS)
}

function matchedTerms(text, terms) {
  var out = []
  for (var i = 0; i < (terms || []).length; i++) {
    var term = String(terms[i] || '').toLowerCase()
    if (term && text.indexOf(term) >= 0) out.push(terms[i])
  }
  return out
}

function isGenericSign(term) {
  return GENERIC_VISUAL_SIGNS.indexOf(term) >= 0
}

function addMatches(state, label, terms, weight, options) {
  options = options || {}
  for (var i = 0; i < (terms || []).length; i++) {
    var term = terms[i]
    if (!term || state.seen[label + term]) continue
    state.score += weight
    state.seen[label + term] = true
    state.matched.push(label + ':' + term)
    if (options.strong) state.strongVisualCount++
    if (options.generic) state.genericOnlyCount++
    if (options.history) state.historyCount++
    if (options.location) state.locationCount++
    if (options.alias) state.aliasCount++
    if (options.breed) state.breedCount++
  }
}

function applyCombinationRules(disease, searchText, bodyPart, state) {
  var name = disease.name
  var locationText = String(bodyPart || '').toLowerCase()

  if (name === '皮肤癣菌病（犬猫）') {
    var hasHairLoss = hasAny(searchText, ['脱毛', '圆形脱毛', '断毛'])
    var hasScaleOrCrust = hasAny(searchText, ['鳞屑', '结痂', '断毛'])
    var hasShape = hasAny(searchText, ['圆形脱毛', '圆形', '环形', '边界清楚', '局灶'])
    if (hasHairLoss && hasScaleOrCrust && hasShape) {
      state.score += 6
      state.comboCount++
      state.matched.push('组合:圆形脱毛+鳞屑/结痂+断毛')
    }
  }

  if (name === '跳蚤过敏性皮炎' || name === '猫粟粒性皮炎（跳蚤过敏）') {
    var hasTailBack = hasAny(searchText + ' ' + locationText, ['尾根', '腰背', '背部', '后躯', '头颈'])
    var hasItch = hasAny(searchText, ['剧烈瘙痒', '瘙痒', '抓挠', '舔咬'])
    var hasFleaDirt = hasAny(searchText, ['黑色颗粒', '跳蚤', '粟粒', '小米粒'])
    if (hasTailBack && hasItch && hasFleaDirt) {
      state.score += 6
      state.comboCount++
      state.matched.push('组合:尾根/背部+瘙痒+跳蚤线索')
    }
  }

  if (name === '猫粟粒性皮炎（跳蚤过敏）' && hasAny(searchText, ['粟粒', '小米粒', '小丘疹多发', '多发丘疹'])) {
    state.score += 8
    state.comboCount++
    state.matched.push('组合:猫粟粒样多发丘疹/结痂')
  }

  if (name === '耳螨感染') {
    var hasEar = hasAny(searchText + ' ' + locationText, ['耳部', '耳道', '耳朵'])
    var hasBlackWax = hasAny(searchText, ['黑褐色', '黑色', '蜡样', '耳垢'])
    var hasHeadShake = hasAny(searchText, ['甩头', '抓耳', '搔抓'])
    if (hasEar && hasBlackWax && hasHeadShake) {
      state.score += 6
      state.comboCount++
      state.matched.push('组合:耳道+黑褐色蜡样分泌物+甩头/抓耳')
    }
  }

  if (name === '马拉色菌皮炎' || name === '马拉色菌性外耳炎') {
    var hasOily = hasAny(searchText, ['油腻', '油', '蜡质油腻', '油腻皮屑'])
    var hasOdor = hasAny(searchText, ['异味', '臭味', '酸臭', '霉味'])
    var hasFoldEarPaw = hasAny(searchText + ' ' + locationText, ['褶皱', '耳部', '耳道', '爪部', '腋下', '腹股沟'])
    if (hasOily && hasOdor && hasFoldEarPaw) {
      state.score += 6
      state.comboCount++
      state.matched.push('组合:油腻+异味+褶皱/耳/爪')
    }
  }

  if (name === '浅表脓皮病' || name === '毛囊炎' || name === '猫浅表脓皮病') {
    if (hasAny(searchText, ['丘疹', '脓疱']) && hasAny(searchText, ['表皮领圈', '环形', '结痂'])) {
      state.score += 5
      state.comboCount++
      state.matched.push('组合:丘疹/脓疱+表皮领圈/结痂')
    }
  }

  if (disease.category === 'mass') {
    if (hasAny(searchText, ['肿块', '结节', '包块', '隆起']) && hasAny(searchText, ['增大', '不愈', '溃疡', '出血', '硬'])) {
      state.score += 5
      state.comboCount++
      state.matched.push('组合:肿块+增大/不愈/破溃')
    }
  }

  // ── 疥螨病：剧痒 + 传人 + 耳缘/肘部 ──
  if (name === '疥螨病') {
    var hasSevereItch = hasAny(searchText, ['剧烈瘙痒', '剧痒', '特别痒', '超级痒'])
    var hasHumanSpread = hasAny(searchText, ['传染人', '人也痒', '人也长'])
    var hasSiteLoc = hasAny(searchText + ' ' + locationText, ['耳缘', '肘部', '腹部', '耳部'])
    if (hasSevereItch && (hasHumanSpread || hasSiteLoc)) {
      state.score += 6
      state.comboCount++
      state.matched.push('组合:剧痒+传人/耳缘肘部')
    }
  }

  // ── 特应性皮炎：慢性反复 + 多部位（爪/腹/耳）──
  if (name === '特应性皮炎（环境过敏）') {
    var hasChronic = hasAny(searchText, ['反复', '慢性', '经常', '一直', '老是', '季节', '每年'])
    var hasMultiSite = (
      hasAny(searchText + ' ' + locationText, ['爪部', '爪子', '脚趾']) +
      hasAny(searchText + ' ' + locationText, ['腹部', '肚子', '腋下']) +
      hasAny(searchText + ' ' + locationText, ['耳部', '耳朵', '面部', '眼周'])
    ) >= 2
    if (hasChronic && hasMultiSite) {
      state.score += 5
      state.comboCount++
      state.matched.push('组合:慢性反复+多部位瘙痒')
    }
  }

  // ── 蠕形螨（局灶型）：面部/眼周脱毛 + 不痒 + 幼犬 ──
  if (name === '蠕形螨病（局灶型）') {
    var hasFace = hasAny(searchText + ' ' + locationText, ['面部', '眼周', '眼睛周围', '鼻梁', '前肢'])
    var hasHairLossD = hasAny(searchText, ['脱毛', '掉毛', '秃'])
    var noItch = hasAny(searchText, ['不痒', '轻痒', '没有痒'])
    if (hasFace && hasHairLossD && noItch) {
      state.score += 6
      state.comboCount++
      state.matched.push('组合:面部/眼周脱毛+不痒')
    }
  }

  // ── 甲减皮肤改变：双侧对称脱毛 + 无瘙痒 + 慢性 ──
  if (name === '甲状腺功能减退相关皮肤改变') {
    var hasSymmetric = hasAny(searchText, ['对称', '两侧', '双侧', '两边'])
    var hasChrHair = hasAny(searchText, ['脱毛', '掉毛'])
    var noItchH = hasAny(searchText, ['不痒', '没痒', '不怎么痒'])
    if (hasSymmetric && hasChrHair && noItchH) {
      state.score += 5
      state.comboCount++
      state.matched.push('组合:双侧对称脱毛+不痒')
    }
  }

  // ── 趾间脓皮病：爪部 + 红肿/舔爪 ──
  if (name === '趾间脓皮病（趾间炎）') {
    var hasPaw = hasAny(searchText + ' ' + locationText, ['爪部', '爪子', '趾间', '脚趾', '脚'])
    var hasLickPaw = hasAny(searchText, ['舔爪', '舔脚', '舔爪子', '一直舔脚'])
    var hasPawSwell = hasAny(searchText, ['红肿', '肿了', '发红'])
    if (hasPaw && (hasLickPaw || hasPawSwell)) {
      state.score += 5
      state.comboCount++
      state.matched.push('组合:爪部+红肿/舔爪')
    }
  }

  // ── 马拉色菌外耳炎：耳朵 + 棕黑分泌物 + 异味 ──
  if (name === '马拉色菌性外耳炎') {
    var hasEarLoc = hasAny(searchText + ' ' + locationText, ['耳部', '耳道', '耳朵'])
    var hasEarWax = hasAny(searchText, ['黄褐色', '棕色', '油腻', '霉味', '酸臭'])
    var hasEarOdor = hasAny(searchText, ['异味', '臭', '霉'])
    if (hasEarLoc && hasEarWax && hasEarOdor) {
      state.score += 6
      state.comboCount++
      state.matched.push('组合:耳道+黄褐/油腻分泌物+异味')
    }
  }

  // ── 细菌性外耳炎：耳朵 + 脓性分泌物 + 疼痛/红肿 ──
  if (name === '细菌性外耳炎') {
    var hasBacterialEarLoc = hasAny(searchText + ' ' + locationText, ['耳部', '耳道', '耳朵', '外耳道'])
    var hasPurulentEar = hasAny(searchText, ['脓性', '脓液', '黄绿色', '化脓', '流脓', '化脓性分泌物'])
    var hasPainOrInflammation = hasAny(searchText, ['疼痛', '触碰疼痛', '红肿', '耳道红肿', '溃疡'])
    if (hasBacterialEarLoc && hasPurulentEar && hasPainOrInflammation) {
      state.score += 7
      state.comboCount++
      state.matched.push('组合:耳道+脓性分泌物+疼痛/红肿')
    }
  }
}

function buildSearchResult(disease, state) {
  var redFlagMatches = matchedTerms(state.searchText, disease.redFlags.concat(RED_FLAG_TERMS))
  var urgency = disease.urgency
  if (redFlagMatches.length && urgency === 'low') urgency = 'moderate'
  if (redFlagMatches.length && disease.category === 'mass') urgency = 'urgent'

  return {
    id: disease.id,
    name: displayDiseaseName(disease, state.species),
    canonicalName: disease.name,
    score: Math.round(state.score * 10) / 10,
    matched: state.matched,
    redFlagMatches: uniq(redFlagMatches),
    typicalFeatures: disease.typicalFeatures,
    ddx: disease.keyDifferentials.map(function (item) { return item.distinguish }).join('；') || disease.ddx,
    keyDifferentials: disease.keyDifferentials,
    recommendedTests: disease.recommendedTests,
    homeCareSafe: disease.homeCareSafe,
    vetAdvice: disease.vetAdvice,
    report: disease.report,
    sources: disease.sources,
    urgency: urgency,
    category: disease.category,
    prevalence: disease.prevalence,
    baselinePriority: disease.baselinePriority,
    visualSigns: disease.visualSigns,
    historySigns: disease.historySigns,
    locations: disease.locations,
    reviewStatus: disease.reviewStatus,
    version: disease.version
  }
}

function countPromptEvidence(result, typePrefix) {
  if (!result || !Array.isArray(result.matched)) return 0
  var count = 0
  for (var i = 0; i < result.matched.length; i++) {
    var item = String(result.matched[i] || '')
    if (item.indexOf(typePrefix) !== 0) continue
    if (typePrefix === '视觉:') {
      var term = item.replace(typePrefix, '')
      if (isGenericSign(term)) continue
    }
    count++
  }
  return count
}

function isPromptWorthyResult(result) {
  if (!result) return false
  var strongVisual = countPromptEvidence(result, '视觉:')
  var history = countPromptEvidence(result, '病史:')
  var alias = countPromptEvidence(result, '别名:')
  var combo = countPromptEvidence(result, '组合:')
  var redFlag = result.redFlagMatches && result.redFlagMatches.length ? 1 : 0
  var evidence = strongVisual + history + alias + combo + redFlag

  if (combo > 0 && result.score >= RAG_PROMPT_MIN_SCORE) return true
  if (evidence >= 2 && result.score >= RAG_PROMPT_MIN_SCORE) return true
  if (alias > 0 && (strongVisual + history + combo + redFlag) > 0 && result.score >= 5) return true
  return false
}

/**
 * 根据病例信息检索知识库
 * @param {Object} query - { species, breed, bodyPart, complaint, visualFeatures, lesionPattern, lesionShape }
 *   visualFeatures: 视觉预检返回的标准词数组，和知识库 keywords 同一词表，优先级高于 complaint 口语
 *   lesionPattern: 视觉预检返回的皮损分布（局灶性/多发性/弥漫性/环形/对称性等）
 *   lesionShape: 视觉预检返回的皮损形态（圆形/环形/不规则等）
 * @returns {Array} 按匹配度排序的 Top 3 条目
 */
function search(query) {
  query = query || {}
  var species = query.species || ''
  var breed = query.breed || ''
  var bodyPart = query.bodyPart || ''
  var complaint = expandQueryTerms(query.complaint || '')
  // 视觉预检标准词：直接拼入搜索文本（它们和知识库用同一套词表）
  var visualFeatures = query.visualFeatures || []
  var lesionPattern = query.lesionPattern || ''
  var lesionShape = query.lesionShape || ''
  var visualFeatText = visualFeatures.join(' ')
  // 搜索文本 = complaint 口语扩展 + 视觉标准词 + 分布形态 + bodyPart + breed
  var searchText = (complaint + ' ' + visualFeatText + ' ' + lesionPattern + ' ' + lesionShape + ' ' + bodyPart + ' ' + breed).toLowerCase()
  var mucosalQuery = isMucosalQuery(bodyPart, searchText)

  var results = []

  for (var i = 0; i < DISEASE_KB.length; i++) {
    var disease = DISEASE_KB[i]
    var state = {
      score: 0,
      matched: [],
      seen: {},
      strongVisualCount: 0,
      genericOnlyCount: 0,
      historyCount: 0,
      locationCount: 0,
      aliasCount: 0,
      breedCount: 0,
      comboCount: 0,
      searchText: searchText,
      species: species
    }

    // 物种过滤：species 不匹配且不是共患的，跳过
    if (species && disease.species.indexOf(species) < 0) {
      continue
    }

    if (mucosalQuery && !diseaseSupportsMucosalLocation(disease)) {
      continue
    }

    var breedMatches = []
    if (breed && disease.breeds && disease.breeds.length > 0) {
      for (var j = 0; j < disease.breeds.length; j++) {
        var bkw = disease.breeds[j]
        if (breed.indexOf(bkw) >= 0 || bkw.indexOf(breed) >= 0) breedMatches.push(bkw)
      }
      addMatches(state, '品种', breedMatches, breedMatches.length > 1 ? 2 : 1, { breed: true })
    }

    var locationMatches = []
    if (bodyPart && disease.locations) {
      for (var k = 0; k < disease.locations.length; k++) {
        var lkw = disease.locations[k]
        if (bodyPart.indexOf(lkw) >= 0 || lkw.indexOf(bodyPart) >= 0) locationMatches.push(lkw)
      }
      addMatches(state, '部位', locationMatches, 2, { location: true })
    }

    // ── 视觉预检标准词匹配（优先于口语，权重更高）──
    // 放在口语匹配之前，让预检先占位 seen key，口语不会重复计分
    if (visualFeatures.length) {
      var vfMatches = matchedTerms(visualFeatText, disease.visualSigns)
      for (var vf = 0; vf < vfMatches.length; vf++) {
        var vfSign = vfMatches[vf]
        // 预检标准词权重：非泛词 5 分，泛词 1.5 分
        addMatches(state, '视觉', [vfSign], isGenericSign(vfSign) ? 1.5 : 5, {
          strong: !isGenericSign(vfSign),
          generic: isGenericSign(vfSign)
        })
      }
    }

    var visualMatches = matchedTerms(complaint, disease.visualSigns)
    for (var v = 0; v < visualMatches.length; v++) {
      var sign = visualMatches[v]
      addMatches(state, '视觉', [sign], isGenericSign(sign) ? 1 : 4, {
        strong: !isGenericSign(sign),
        generic: isGenericSign(sign)
      })
    }

    var historyMatches = matchedTerms(complaint, disease.historySigns)
    addMatches(state, '病史', historyMatches, 3, { history: true })

    var aliasMatches = matchedTerms(searchText, disease.aliases)
    if (aliasMatches.length) addMatches(state, '别名', [aliasMatches[0]], 2, { alias: true })

    applyCombinationRules(disease, searchText, bodyPart, state)

    if (state.score > 0) {
      // ── negativeSignals 扣分：如果搜索文本中有该病的排除信号，降权 ──
      var negatives = NEGATIVE_SIGNALS[disease.name]
      if (negatives) {
        var negCount = 0
        for (var n = 0; n < negatives.length; n++) {
          if (searchText.indexOf(negatives[n]) >= 0) negCount++
        }
        if (negCount > 0) {
          // 每命中一个 negative 扣 3 分，最多扣到原始分的 70%
          state.score = Math.max(state.score * 0.3, state.score - negCount * 3)
          state.matched.push('负信号:-' + negCount)
        }
      }

      // 高发常见病加权：优先级 5→+2.5, 4→+2, 3→+1.5, 2→+1
      // 放在过滤之前，确保高发病不会被低分阈值误杀
      state.score += disease.baselinePriority * 0.5

      // ── 泛词过滤加强：仅有泛词命中 + 无组合/部位/品种/病史/别名 → 过滤 ──
      var hasSpecificEvidence = state.strongVisualCount > 0 || state.locationCount > 0 || state.historyCount > 0 || state.aliasCount > 0 || state.comboCount > 0 || state.breedCount > 0
      if (!hasSpecificEvidence && state.genericOnlyCount > 0) continue
      // 即使有部位命中，如果只有 1 个泛词 + 1 个部位且无其他证据，分数不够置信
      if (!state.strongVisualCount && !state.historyCount && !state.aliasCount && !state.comboCount && state.score < 5) continue

      results.push(buildSearchResult(disease, state))
    }
  }

  // 按分数降序，取 Top 3
  results.sort(function (a, b) { return b.score - a.score })
  return results.slice(0, 3)
}

/**
 * 构建知识库检索 prompt 段落
 * @param {Object} query - { species, breed, bodyPart, complaint }
 * @returns {string} 注入 prompt 的文本，未匹配时返回空字符串
 */
function buildRagPrompt(query) {
  var results = search(query).filter(isPromptWorthyResult)
  if (results.length === 0) return ''

  // 精简核对清单：给模型复核方向，但不允许替代诊断结论。
  var parts = ['--- 临床参考核对清单（仅用于复核，不是结论）---']

  for (var i = 0; i < results.length; i++) {
    var r = results[i]
    parts.push('[' + (i + 1) + '] ' + r.name)
    if (r.typicalFeatures) parts.push('  观察依据：' + r.typicalFeatures)
    if (r.keyDifferentials && r.keyDifferentials.length) {
      parts.push('  鉴别：' + r.keyDifferentials[0].distinguish)
    }
    parts.push('  不确定性：单靠照片不能确诊，必须结合病史、体检和必要检查。')
    if (r.recommendedTests && r.recommendedTests.length) {
      parts.push('  下一步：' + r.recommendedTests.slice(0, 2).join('；'))
    }
  }

  parts.push('规则：照片+部位+病史同时吻合才采用；不吻合可以完全不采用。不要把低频病在仅有泛词时推为第一。不要写“确诊”，不要在报告中提及检索或知识库。')

  return parts.join('\n')
}

module.exports = {
  DISEASE_KB: DISEASE_KB,
  search: search,
  isPromptWorthyResult: isPromptWorthyResult,
  buildRagPrompt: buildRagPrompt,
  // 受控词表（供视觉提取 prompt 复用，确保两端对齐）
  VISUAL_VOCAB: VISUAL_VOCAB,
  VISUAL_VOCAB_GROUPS: VISUAL_VOCAB_GROUPS,
  HISTORY_VOCAB: HISTORY_VOCAB,
  classifySign: classifySign
}
