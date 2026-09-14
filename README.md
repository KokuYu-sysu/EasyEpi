# EasyEpi

EasyEpi 是面向流行病学与社会调查的 Windows 桌面应用，集成问卷设计、问卷录入、数据管理、统计分析和 AI 问卷助手。核心业务离线运行；AI 功能仅在用户主动发送时连接所配置的服务。

AI 问卷助手的LLM选用 DeepSeek：服务地址固定为 `https://api.deepseek.com`，（默认LLM模型为 `deepseek-v4.1-flash`）、用户需要手动填写 API Key 。

## 开发环境

- Windows 10/11 x64
- Node.js `>=22.12 <25`
- pnpm `>=11 <12`

## 使用

### 用户界面

![Introduction page](public/images/Introduction.png)

用户通过右上角的`新建项目`或者`打开项目`进行工作：其中首次创建项目需要准备一份密码，以供后面验证。

![Create Project](public/images/CreateProject.png)

### 问卷设计

主要展示页面：

![Questionnaire Design](public/images/QuestionnaireDesign.png)

添加题目通过右上角的 `新增题目`实现对应功能：

![Add Question](public/images/AddQuestion.png)

题目类型有单选题、多选题、固定长度填空、自由填空、数字范围填空和日期填空。

题目设定为Key时表示必须填入，通常情况下用于用户识别使用。除此之外，还可以设定条件，在特定时候进行题目的展示和跳跃：

![Condition Question](public/images/ConditionQuestion.png)

### EpiData问卷导入

支持Epidata问卷格式`.qes`的导入：

![Epidata Import](public/images/EpidataImport.png)

### 问卷录入

![Question Work](public/images/QuestionWork.png)

### AI问卷助手

我的提示词为：

```JSON
现在帮我建立一份中国老年慢性病调查的问卷，需要包括饮食因素，生活因素和中国现在较为流行的慢性病的因素
```

问卷回复信息：

![AI Support](public/images/AISupport.png)

其设计好的问卷支持一键导入并支持后续修改：

### 管理员功能：

因为在实际上，我们在问卷设计好给现场工作人员录入后，我们不想让他人直接看到之前的数据或者导出数据，因此需要管理员的二重验证，在登陆后台后，可以看到数据的情况

![Data Quality](public/images/DataQuality.png)

在这里，我们支持看数据表格、生成基线表对数据进行初步的统计、数据质量的监测、支持问卷的双录入、问卷数据的导出（支持`.csv`格式）、修改管理员密码。支持衍生变量的计算：

![New Variable](public/images/NewVariable.png)

支持多种运算方式，比如类似于LaTeX的表示符也可以直接进行点击的计算操作

### 其他特性：

黑夜模式：

![Dark Mode](public/images/DarkMode.png)

更大的字体：

![Big font](public/images/Bigfont.png)

备份与恢复：

![Recovery](public/images/Recovery.png)

AI设置：API输入与模型选择

![API setting](public/images/APIsetting.png)

## 其余信息

版本号： 0.8.0

制作人： Jiahao Lin

[个人主页](kokuyublog.com)：内涵更多统计等方面学习资料

开发支持：Deepseek V4、ChatGPT 5.6 Sol、Xiaomi MiMo 2.5 pro
