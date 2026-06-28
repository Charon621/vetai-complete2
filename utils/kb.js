// ============================================================
// utils/kb.js
// 宠物皮肤病知识库 + 检索函数（RAG）
// 纯本地 JS，无后端无数据库，检索 < 1ms
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
    urgency: 'low'
  },

  {
    name: '跳蚤过敏性皮炎',
    aliases: ['跳蚤过敏', '跳蚤', 'flea allergy'],
    species: ['犬', '猫'],
    keywords: {
      breeds: [],
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
    urgency: 'moderate'
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
    ddx: '与浅表脓皮病区分：深部脓皮病累及真皮层，有结节和瘘管',
    urgency: 'urgent'
  },

  {
    name: '蠕形螨病',
    aliases: ['蠕形螨', 'demodectic mange', 'demodicosis'],
    species: ['犬'],
    keywords: {
      breeds: ['金毛', '德牧', '法斗', '英斗', '巴哥', '沙皮', '柴犬'],
      locations: ['面部', '眼周', '前肢', '爪部', '全身'],
      symptoms: ['脱毛', '红斑', '皮屑', '增厚', '不痒', '轻痒', '对称', '慢性']
    },
    typicalFeatures: '局灶型：面部/前肢对称性脱毛、红斑、皮屑，早期不痒或轻痒；全身型：大面积脱毛、皮肤增厚呈蓝灰色',
    ddx: '与真菌感染区分：蠕形螨早期不痒或轻痒，真菌通常瘙痒剧烈；与脓皮病区分：蠕形螨对称性脱毛更明显',
    urgency: 'moderate'
  },

  {
    name: '疥螨病',
    aliases: ['疥螨', '疥疮', 'sarcoptic mange', 'scabies'],
    species: ['犬'],
    keywords: {
      breeds: [],
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
    urgency: 'low'
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
    ddx: '与趾间炎区分：舔舐肉芽肿在肢侧面而非趾间，为单个顽固结节；与肿瘤区分：活检可鉴别',
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
    ddx: '与落叶天疱疮区分：锌反应性皮病好发鼻部和压力点，天疱疮通常更广泛',
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
      breeds: [],
      locations: ['背部', '腰部', '颈部', '头部', '尾根'],
      symptoms: ['结痂', '粟粒', '瘙痒', '抓挠', '脱毛', '红疹', '小米粒']
    },
    typicalFeatures: '背部和颈部大量小米粒大小结痂性丘疹，猫频繁抓挠，跳蚤过敏最常见表现',
    ddx: '与猫癣区分：粟粒性皮炎为多发小丘疹结痂伴剧痒，癣菌为圆形脱毛鳞屑',
    urgency: 'low'
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
    ddx: '与肿瘤区分：EGC 多发于年轻猫，唇部无痛性溃疡是特征性表现，活检可鉴别',
    urgency: 'moderate'
  },

  {
    name: '猫痤疮',
    aliases: ['猫下巴痤疮', '下巴黑点', 'feline acne'],
    species: ['猫'],
    keywords: {
      breeds: [],
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
      breeds: ['暹罗', '东方短毛', '阿比西尼亚'],
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
    ddx: '与日光性皮炎区分：鳞癌为增生性溃疡不愈、可能出血，活检确诊',
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
      breeds: [],
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
      breeds: [],
      locations: ['面部', '耳部', '耳尖', '鼻部', '爪部'],
      symptoms: ['剧烈瘙痒', '结痂', '增厚', '皱褶', '传染', '人也有', '皮屑']
    },
    typicalFeatures: '从耳尖和面部开始剧烈瘙痒、结痂和皮肤增厚皱褶，人接触也可瘙痒',
    ddx: '与耳螨区分：猫疥螨从耳尖和面部皮肤开始，耳螨主要在耳道内',
    urgency: 'moderate'
  },

  {
    name: '猫泪痕皮炎',
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
      breeds: [],
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
      breeds: [],
      locations: ['腹部', '躯干', '面部', '爪部', '下巴'],
      symptoms: ['丘疹', '脓疱', '结痂', '脱毛', '红斑', '溃疡']
    },
    typicalFeatures: '丘疹、脓疱、结痂和脱毛，常继发于跳蚤过敏、猫癣或食物过敏',
    ddx: '与猫癣区分：脓皮病通常有脓疱，癣菌为圆形脱毛鳞屑无脓疱',
    urgency: 'moderate'
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
    ddx: '与囊肿区分：肿瘤通常持续增大，活检是确诊手段；任何不愈合的溃疡或增大肿块需就医',
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
    ddx: '与锌反应性皮病区分：胼胝局限压力点并与卧地摩擦相关，锌反应性常累及鼻唇和多处角化',
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
    ddx: '与天疱疮区分：单纯角化过度以厚硬角质为主，天疱疮常伴脓疱、结痂和多部位扩散',
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
// 检索函数
// ============================================================

var KB_VERSION = '2026-06-28'

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
    { title: 'Merck Veterinary Manual - Malassezia Dermatitis in Dogs and Cats', url: 'https://www.merckvetmanual.com/integumentary-system/malassezia-dermatitis/malassezia-dermatitis-in-dogs-and-cats', tier: 'manual' },
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

var GENERIC_VISUAL_SIGNS = ['红肿', '脱毛', '瘙痒', '结痂', '红斑', '皮屑', '鳞屑', '抓挠', '舔舐', '发红']
var RED_FLAG_TERMS = ['快速扩大', '大面积破溃', '流脓', '明显疼痛', '精神食欲异常', '不愈', '出血', '呼吸困难', '面部肿胀', '幼猫严重感染', '人也出现皮损']

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

function inferCategory(entry) {
  var text = [entry.name].concat(entry.aliases || []).join(' ').toLowerCase()
  if (text.indexOf('耳') >= 0 || text.indexOf('otitis') >= 0 || text.indexOf('ear') >= 0 || text.indexOf('otodectes') >= 0) return 'ear'
  if (text.indexOf('跳蚤') >= 0 || text.indexOf('螨') >= 0 || text.indexOf('蜱') >= 0 || text.indexOf('虫') >= 0 || text.indexOf('mange') >= 0 || text.indexOf('mite') >= 0) return 'parasite'
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
  if (category === 'mass' || entry.urgency === 'urgent' || entry.urgency === 'emergency') return 5
  if (['特应性皮炎（环境过敏）', '跳蚤过敏性皮炎', '浅表脓皮病', '马拉色菌皮炎', '皮肤癣菌病（犬猫）', '耳螨感染'].indexOf(name) >= 0) return 4
  if (category === 'allergy' || category === 'bacterial' || category === 'parasite' || category === 'ear' || category === 'yeast') return 3
  return 2
}

function inferPrevalence(priority, category) {
  if (priority >= 4 && category !== 'mass') return 'common'
  if (category === 'mass' || category === 'rare_warning') return 'low_frequency_warning'
  return 'uncommon'
}

function buildDifferentials(entry) {
  if (!entry.ddx) return []
  var name = '相似皮肤问题'
  var match = entry.ddx.match(/与(.+?)区分/)
  if (match && match[1]) name = match[1]
  return [{ name: name, distinguish: entry.ddx }]
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
  var visualSigns = uniq((entry.visualSigns || []).concat((entry.keywords && entry.keywords.symptoms) || []))
  var historySigns = uniq((entry.historySigns || []).concat(
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
    ddx: entry.ddx || ''
  }
}

DISEASE_KB = DISEASE_KB.map(toClinicalCard)

function expandQueryTerms(text) {
  var source = String(text || '').toLowerCase()
  if (!source) return ''

  var extra = []
  var groups = [
    { terms: ['掉毛', '秃毛', '秃了一块', '毛少', '毛稀', '脱发'], add: ['脱毛'] },
    { terms: ['圆斑', '圆形斑', '圆圈', '圆形', '环形', '环形脱毛', '圆形掉毛', '圆形秃毛', '边界清楚'], add: ['圆形脱毛'] },
    { terms: ['单片', '一块', '局部一块', '局灶性'], add: ['局灶'] },
    { terms: ['皮屑', '白屑', '碎屑', '屑'], add: ['鳞屑'] },
    { terms: ['痂皮', '硬痂', '结壳', '结疤'], add: ['结痂'] },
    { terms: ['毛断', '断裂毛', '毛发折断', '断毛发'], add: ['断毛'] },
    { terms: ['泛红', '发红', '红色', '发炎'], add: ['红斑', '红肿'] },
    { terms: ['流液', '渗液', '渗水', '流水', '湿的', '湿润'], add: ['渗出', '潮湿'] },
    { terms: ['鼓包', '包块', '疙瘩', '肉疙瘩', '隆起'], add: ['肿块', '结节'] },
    { terms: ['破了', '破皮', '烂了', '溃烂'], add: ['破溃', '溃疡'] },
    { terms: ['黄色分泌物', '脓液', '有脓'], add: ['流脓', '脓'] },
    { terms: ['舔咬', '一直舔', '频繁舔'], add: ['舔舐', '舔爪'] },
    { terms: ['抓', '挠', '抓挠'], add: ['搔抓', '瘙痒'] },
    { terms: ['臭味', '酸臭', '霉味'], add: ['异味'] },
    { terms: ['黑点', '黑色颗粒'], add: ['黑色颗粒'] },
    { terms: ['会传染', '人也长', '人也痒'], add: ['传染人'] }
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
    var hasOily = hasAny(searchText, ['油腻', '油', '耳垢'])
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

/**
 * 根据病例信息检索知识库
 * @param {Object} query - { species, breed, bodyPart, complaint }
 * @returns {Array} 按匹配度排序的 Top 3 条目
 */
function search(query) {
  query = query || {}
  var species = query.species || ''
  var breed = query.breed || ''
  var bodyPart = query.bodyPart || ''
  var complaint = expandQueryTerms(query.complaint || '')
  var searchText = (complaint + ' ' + bodyPart + ' ' + breed).toLowerCase()

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
      var hasSpecificEvidence = state.strongVisualCount > 0 || state.locationCount > 0 || state.historyCount > 0 || state.aliasCount > 0 || state.comboCount > 0
      if (!hasSpecificEvidence && state.genericOnlyCount > 0) continue
      state.score += Math.min(2, disease.baselinePriority * 0.25)
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
  var results = search(query)
  if (results.length === 0) return ''

  var parts = ['--- 临床知识库候选方向（根据物种/部位/视觉特征/病史加权检索，仅供初筛对照）---']

  for (var i = 0; i < results.length; i++) {
    var r = results[i]
    parts.push('[' + (i + 1) + '] ' + r.name + '（匹配分 ' + r.score + '；' + r.prevalence + '；' + r.reviewStatus + '）')
    if (r.matched && r.matched.length) {
      parts.push('  观察依据：' + r.matched.join('、'))
    }
    if (r.typicalFeatures) {
      parts.push('  典型特征：' + r.typicalFeatures)
    }
    if (r.keyDifferentials && r.keyDifferentials.length) {
      parts.push('  鉴别要点：' + r.keyDifferentials.map(function (item) {
        return item.name + '：' + item.distinguish
      }).join('；'))
    }
    if (r.recommendedTests && r.recommendedTests.length) {
      parts.push('  建议检查：' + r.recommendedTests.slice(0, 4).join('、'))
    }
    if (r.redFlagMatches && r.redFlagMatches.length) {
      parts.push('  已触发红旗：' + r.redFlagMatches.join('、'))
    }
    if (r.vetAdvice) {
      parts.push('  下一步：' + r.vetAdvice)
    }
    if (r.report && r.report.uncertainty) {
      parts.push('  不确定性：' + r.report.uncertainty)
    }
    parts.push('')
  }

  parts.push('输出时只能写“可能方向/鉴别方向/建议检查”，不要写“确诊”“就是”或药物处方。报告必须包含：观察依据、不确定性、下一步。')
  parts.push('若只有红肿、脱毛、瘙痒、结痂等泛词，不要单独把某个低频病推为第一；优先使用组合特征和常见病解释。')

  return parts.join('\n')
}

module.exports = {
  DISEASE_KB: DISEASE_KB,
  search: search,
  buildRagPrompt: buildRagPrompt
}
