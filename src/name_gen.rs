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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_is_adj_space_animal_hash_num() {
        let name = generate_name();
        // Format: "{adj} {animal} #{1-99}"
        let parts: Vec<&str> = name.split(" #").collect();
        assert_eq!(parts.len(), 2, "名称应包含 ' #' 分隔符: {}", name);

        let prefix = parts[0];
        let num_str = parts[1];

        // Number part should be 1-99
        let num: u32 = num_str.parse().expect("数字部分应为有效整数");
        assert!((1..=99).contains(&num), "数字应在 1-99 范围内: {}", num);

        // Prefix should be "{adj} {animal}"
        let prefix_parts: Vec<&str> = prefix.split(' ').collect();
        assert_eq!(prefix_parts.len(), 2, "前缀应为 '形容词 动物': {}", prefix);

        let adj = prefix_parts[0];
        let animal = prefix_parts[1];
        assert!(ADJECTIVES.contains(&adj), "形容词应在列表中: {}", adj);
        assert!(ANIMALS.contains(&animal), "动物应在列表中: {}", animal);
    }

    #[test]
    fn generates_different_names() {
        let names: std::collections::HashSet<String> = (0..50)
            .map(|_| generate_name())
            .collect();
        // With 20 adjectives * 20 animals * 99 numbers = 39600 combos,
        // getting 50 unique names out of 50 is virtually guaranteed
        assert!(names.len() > 10, "应生成多个不同名称，实际 {} 个", names.len());
    }

    #[test]
    fn name_not_empty() {
        let name = generate_name();
        assert!(!name.is_empty());
    }
}
