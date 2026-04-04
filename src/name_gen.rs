use rand::seq::SliceRandom;

const ADJECTIVES: &[&str] = &[
    "橘色", "蓝色", "红色", "绿色", "紫色", "金色", "银色", "粉色", "青色", "橙色",
    "快乐", "勇敢", "温柔", "聪明", "可爱", "活泼", "安静", "优雅", "憨厚", "机灵",
];

const ANIMALS: &[&str] = &[
    "狐狸", "海豚", "熊猫", "兔子", "猫咪", "企鹅", "鹿", "松鼠", "考拉", "水獭",
    "鹦鹉", "仓鼠", "浣熊", "刺猬", "鲸鱼", "海豹", "天鹅", "蝴蝶", "花栗鼠", "羊驼",
];

pub fn generate_name() -> String {
    let mut rng = rand::thread_rng();
    let adj = ADJECTIVES.choose(&mut rng).unwrap();
    let animal = ANIMALS.choose(&mut rng).unwrap();
    let num = rand::Rng::gen_range(&mut rng, 1..=99);
    format!("{} {} #{}", adj, animal, num)
}
