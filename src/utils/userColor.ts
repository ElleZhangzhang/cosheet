// 明确：按用户生成固定颜色和头像首字母

const USER_COLORS = [
  "#a9793b",
  "#4d7cba",
  "#4b946d",
  "#b45f4d",
  "#8064a8",
  "#a56a2a",
];

const FALLBACK_COLOR = "#a9793b";

// 通过哈希算法，根据用户ID随机分配颜色，并且同一用户的颜色一定是一样的
function getUserColor(userId: string): string {
  let hash = 0;

  // userId.charCodeAt(index) = userId[index].charCodeAt()
  for (let index = 0; index < userId.length; index += 1) {
    // KNOW
    // 为什么要乘？因为不乘哈希值hash容易重复，乘可以不停增加已乘数字的权重，保证离散性
    // 为什么是31？经验值。不小避免hash重复（比如2/10），不大避免超出范围变成负数，并且31是质数，不容易造成重复
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  }

  return USER_COLORS[hash % USER_COLORS.length] ?? FALLBACK_COLOR;
}

// 提取user_name首字符
function getUserInitial(name: string): string {
  const trimmed = name.trim();

  // KNOW Array.from能完美识别Unicode字符，保证截取出来的是一个完整的字
  const first = Array.from(trimmed)[0];

  return first ? first.toUpperCase() : "?";
}

export { getUserColor, getUserInitial };
