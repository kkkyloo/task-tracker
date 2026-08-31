import fs from 'fs';
import dotenv from 'dotenv';
import { Bot, Keyboard, ImageAttachment } from '@maxhub/max-bot-api';

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = "-74876760090817"; // ID вашей группы
const USER_STATE_FILE = 'user_state.json';

if (!BOT_TOKEN) {
    console.error("❌ Ошибка: В .env файле не найден BOT_TOKEN!");
    process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

let userState = {};
let photoTimers = {};

// --- Чтение и сохранение состояний (аналог JSON-хранилища в Python) ---
function loadUserState() {
    if (fs.existsSync(USER_STATE_FILE)) {
        try {
            const data = fs.readFileSync(USER_STATE_FILE, 'utf-8');
            userState = JSON.parse(data);
        } catch (e) {
            console.error("Ошибка чтения файла состояний:", e);
            userState = {};
        }
    }
}

function saveUserState(userId) {
    // Обновляем метку активности для конкретного пользователя
    if (userId && userState[userId]) {
        userState[userId].last_active = Date.now();
    }
    try {
        fs.writeFileSync(USER_STATE_FILE, JSON.stringify(userState, null, 4), 'utf-8');
    } catch (e) {
        console.error("Ошибка сохранения файла состояний:", e);
    }
}

// Удаляем личные данные после отправки, оставляем только state='completed'
function clearPersonalData(userId) {
    const s = userState[String(userId)];
    if (!s) return;
    userState[String(userId)] = { state: 'completed', last_active: Date.now() };
    saveUserState();
}

// Чистим сессии старше 24ч, уведомляем пользователей с незавершёнными сессиями
async function cleanupStaleStates() {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let changed = false;
    for (const uid of Object.keys(userState)) {
        const s = userState[uid];
        const ts = s.last_active || 0;
        if (ts < cutoff) {
            // Уведомляем только тех, кто был в процессе (не завершённых и не просто 'completed')
            const isIncomplete = s.state && s.state !== 'completed';
            if (isIncomplete) {
                try {
                    await bot.api.sendMessageToChat(uid,
                        `⏰ Ваша незавершённая заявка была сброшена из-за 24 часов неактивности.\n\nЧтобы начать заново, нажмите кнопку ниже или напишите /start.`,
                        { attachments: [Keyboard.inlineKeyboard([[Keyboard.button.callback('🔄 Начать заново', 'restart_bot')]])] }
                    );
                } catch (e) {
                    console.warn(`Не удалось уведомить пользователя ${uid}:`, e.message);
                }
            }
            delete userState[uid];
            changed = true;
        }
    }
    if (changed) {
        saveUserState();
        console.log("🧹 Устаревшие сессии очищены");
    }
}

loadUserState();

// --- Извлечение номера телефона из vCard или max_info ---
function extractPhoneFromContact(attachment) {
    const payload = attachment?.payload;
    if (!payload) return null;

    // Пробуем vCard
    const vcfInfo = payload.vcf_info;
    if (vcfInfo) {
        const match = vcfInfo.match(/TEL[^:\r\n]*:[ \t]*(\+?\d[\d\s\-().]{6,})/i);
        if (match) return match[1].replace(/\D/g, '').replace(/^8/, '+7').replace(/^7/, '+7');
    }

    // Пробуем max_info (объект с полем phone)
    if (payload.max_info?.phone) return payload.max_info.phone;

    // Пробуем прямое поле phone в payload
    if (payload.phone) return payload.phone;

    return null;
}

// --- Клавиатуры (В МАКС используются только inline-клавиатуры) ---
const mainMenuKeyboard = Keyboard.inlineKeyboard([
    [Keyboard.button.callback('🔄 Перезапустить бота', 'restart_bot')]
]);

const phoneRequestKeyboard = Keyboard.inlineKeyboard([
    [Keyboard.button.requestContact('📱 Отправить мой номер телефона')],
    [Keyboard.button.callback('⌨️ Ввести вручную', 'manual_phone_input')],
    [Keyboard.button.callback('🔄 Перезапустить бота', 'restart_bot')]
]);

// --- Инициализация старта диалога ---
async function initiateDialogStart(ctx, userId) {
    userState[userId] = {
        state: 'waiting_for_name',
        name: null,
        inquiry_type: null,
        damage_description: null,
        photoTokens: [],
        photoPayloads: [],
        contact_method: null,
        phone: null,
        final_message: null,
        last_active: Date.now()
    };
    saveUserState();
    
    await ctx.reply(`👋 Здравствуйте, ${ctx.user.first_name || 'гость'}! Я бот АСТА-АВТО.\nНапишите, пожалуйста, как к Вам обращаться.`, {
        attachments: [mainMenuKeyboard]
    });
}

// --- Показ меню выбора услуги ---
async function askInquiryType(ctx) {
    const markup = Keyboard.inlineKeyboard([
        [Keyboard.button.callback('📷 Оценка ремонта по фото', 'service_photo_estimate')],
        [Keyboard.button.callback('💬 Общий вопрос менеджеру', 'service_general_question')]
    ]);
    await ctx.reply('Чем я могу Вам помочь?', { attachments: [markup] });
}

// --- Обработчик начала диалога (когда нажали "Запустить") ---
bot.on('bot_started', async (ctx) => {
    const userId = String(ctx.user.user_id);
    await initiateDialogStart(ctx, userId);
});

// --- Обработчик команды /start в чате ---
bot.command('start', async (ctx) => {
    const userId = String(ctx.user.user_id);
    await initiateDialogStart(ctx, userId);
});

// --- Основной обработчик сообщений (Текст и Медиа) ---
bot.on('message_created', async (ctx) => {
    const userId = String(ctx.user.user_id);
    const text = ctx.message.body?.text?.trim();
    
    // Игнорируем сообщения от самого бота
    if (ctx.user.is_bot) return;

    // Игнорируем сообщения из чата админов, чтобы не сбивать логику
    if (String(ctx.message?.recipient?.chat_id) === ADMIN_CHAT_ID ||
        String(ctx.chatId) === ADMIN_CHAT_ID) {
        return;
    }

    // Обработка кнопки "Перезапуск"
    if (text === '🔄 Перезапустить бота' || text === '/start') {
        await initiateDialogStart(ctx, userId);
        return;
    }

    const stateObj = userState[userId];
    if (!stateObj) {
        await initiateDialogStart(ctx, userId);
        return;
    }

    const state = stateObj.state;

    if (state === 'completed') {
        await ctx.reply("Ваша заявка уже отправлена. Чтобы начать новый диалог, нажмите кнопку 'Отправить еще' или напишите 'Перезапустить бота'.", {
            attachments: [mainMenuKeyboard]
        });
        return;
    }

    // --- Сбор фотографий ---
    if (state === 'waiting_for_photo') {
        // ВАЖНО: вложения лежат в message.body.attachments, а НЕ в message.attachments
        const bodyAttachments = ctx.message.body?.attachments || [];
        const images = bodyAttachments.filter(att => att.type === 'image');

        if (images.length > 0) {
            if (!stateObj.photoPayloads) stateObj.photoPayloads = [];
            if (!stateObj.photoTokens) stateObj.photoTokens = [];

            let added = 0;
            images.forEach(img => {
                const payload = img.payload;
                if (!payload) {
                    console.warn('⚠️ Изображение без payload:', JSON.stringify(img));
                    return;
                }
                stateObj.photoPayloads.push(payload);
                if (payload.token) stateObj.photoTokens.push(payload.token);
                added++;
            });
            saveUserState();

            if (added > 0) {
                await ctx.reply("✅ Фото принято! Можете отправить еще...");
            }

            clearTimeout(photoTimers[userId]);
            photoTimers[userId] = setTimeout(() => finalizePhotoAlbum(ctx, userId), 2000);
            return;
        } else if (bodyAttachments.length > 0) {
            // Пришло вложение, но не фото (стикер, файл и т.д.)
            await ctx.reply("❌ Неверный формат. Пожалуйста, отправьте именно ФОТО.", {
                attachments: [mainMenuKeyboard]
            });
            return;
        } else if (text) {
            await ctx.reply("❌ Неверный формат. Пожалуйста, отправьте именно ФОТО.", {
                attachments: [mainMenuKeyboard]
            });
            return;
        }
        return; // пустое сообщение без вложений — игнорируем
    }

    // --- Ввод Телефона (Контакт или Ручной ввод) ---
    if (state === 'waiting_for_phone' || state === 'changing_phone') {
        let phoneInput = null;

        // 1. Проверяем контакт через SDK (ctx.contactInfo парсит vcf автоматически)
        if (ctx.contactInfo?.tel) {
            let tel = String(ctx.contactInfo.tel).replace(/\D/g, '');
            if (tel.startsWith('8')) tel = '7' + tel.slice(1);
            if (!tel.startsWith('+')) tel = '+' + tel;
            phoneInput = tel;
            console.log(`📱 Контакт через SDK: ${phoneInput}`);
        }

        // Fallback: ищем вручную в body.attachments (на случай нестандартного формата)
        if (!phoneInput) {
            const bodyAttachments = ctx.message.body?.attachments || [];
            const contactAttachment = bodyAttachments.find(
                att => att.type === 'contact' || att.type === 'share'
            );
            if (contactAttachment) {
                console.log('📋 Контакт (raw):', JSON.stringify(contactAttachment));
                const extractedPhone = extractPhoneFromContact(contactAttachment);
                if (extractedPhone) {
                    phoneInput = extractedPhone;
                    console.log(`📱 Из контакта (raw): ${phoneInput}`);
                }
            }
        }

        // 2. Если контакта нет, пробуем прочитать обычный текст
        if (!phoneInput && text) {
            if (text === '⌨️ Ввести вручную') {
                await ctx.reply("✍️ Введите номер как +7XXXXXXXXXX:", {
                    attachments: [mainMenuKeyboard]
                });
                return;
            }
            phoneInput = text.replace(/\s+/g, '');
        }

        if (!phoneInput) return; // Игнорируем пустые или нерелевантные сообщения

        // Проверяем формат +7XXXXXXXXXX
        if (!/^\+7\d{10}$/.test(phoneInput)) {
            await ctx.reply("❌ Неверный формат. Введите номер как +7XXXXXXXXXX.", {
                attachments: [phoneRequestKeyboard]
            });
            return;
        }

        stateObj.phone = phoneInput;
        if (stateObj.inquiry_type === 'photo_estimate') {
            await ctx.reply("✅ Отправляю вашу заявку менеджеру...", {
                attachments: [mainMenuKeyboard]
            });
            await sendDataToAdmin(ctx, userId);
        } else {
            stateObj.state = 'waiting_for_final_message';
            const changePhoneMarkup = Keyboard.inlineKeyboard([
                [Keyboard.button.callback('✏️ Изменить номер', 'change_phone_request')]
            ]);
            await ctx.reply("✅ Номер принят.\n📝 Напишите Ваше сообщение:", {
                attachments: [changePhoneMarkup]
            });
        }
        saveUserState();
        return;
    }

    // Все последующие текстовые стейты
    if (!text) return;

    // --- Ввод Имени ---
    if (state === 'waiting_for_name') {
        stateObj.name = text;
        stateObj.state = null;
        saveUserState();
        await ctx.reply(`🤝 Приятно познакомиться, ${text}!`);
        await askInquiryType(ctx);
        return;
    }

    // --- Ввод Описания повреждений ---
    if (state === 'waiting_for_damage_description') {
        stateObj.damage_description = text;
        stateObj.state = 'waiting_for_photo';
        saveUserState();
        await ctx.reply("👍 Отлично. Теперь, пожалуйста, отправьте фото (можно сразу несколько).", {
            attachments: [mainMenuKeyboard]
        });
        return;
    }

    // --- Ввод Финального сообщения для общего вопроса ---
    if (state === 'waiting_for_final_message') {
        stateObj.final_message = text;
        saveUserState();
        await ctx.reply("✅ Отправляю вашу заявку менеджеру...", {
            attachments: [mainMenuKeyboard]
        });
        await sendDataToAdmin(ctx, userId);
        return;
    }

    // Если сообщение не распознано стейт-машиной
    await ctx.reply("😕 Не понял Вас. Нажмите '🔄 Перезапустить бота'.", {
        attachments: [mainMenuKeyboard]
    });
});

// --- Сборка альбома фото по таймеру ---
async function finalizePhotoAlbum(ctx, userId) {
    const stateObj = userState[userId];
    const hasPhotos = (stateObj.photoPayloads?.length > 0) || (stateObj.photoTokens?.length > 0);
    if (!stateObj || !hasPhotos) return;

    stateObj.state = 'photo_confirmation';
    saveUserState();

    const confirmMarkup = Keyboard.inlineKeyboard([
        [Keyboard.button.callback('✅ Да, всё верно', 'photo_confirm_yes')],
        [Keyboard.button.callback('🔄 Заменить фото', 'photo_confirm_replace')],
        [Keyboard.button.callback('❌ Отменить', 'photo_confirm_cancel')]
    ]);

    const photoPayloads = stateObj.photoPayloads || stateObj.photoTokens.map(t => ({ token: t }));
    const attachments = photoPayloads.map(p => new ImageAttachment(p).toJson());
    attachments.push(confirmMarkup);

    await ctx.reply("Вы отправили следующие фото. Всё верно?", {
        attachments: attachments
    });
}

// --- Обработчик интерактивных кнопок ---
bot.on('message_callback', async (ctx) => {
    const action = ctx.callback?.payload;
    const userId = String(ctx.callback?.user?.user_id || ctx.user?.user_id);
    const stateObj = userState[userId];

    if (!action) {
        console.warn("⚠️ Получен пустой payload в callback-событии");
        return;
    }

    // --- Кнопка принятия заявки менеджером в группе ---
    if (action.startsWith('accept_request_')) {
        const adminUser = ctx.callback?.user || ctx.user || {};
        const adminName = adminUser.name || adminUser.first_name || 'Менеджер';
        const adminUserId = adminUser.user_id;
        const acceptedTime = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
        const adminProfileLink = `<a href="max://user/${adminUserId}">${adminName}</a>`;

        // Оригинал не трогаем — история сохраняется. Просто отправляем отдельное уведомление.
        try {
            await ctx.api.sendMessageToChat(ADMIN_CHAT_ID,
                `✅ <b>Заявка принята в обработку!</b>\n👤 <b>Менеджер:</b> ${adminProfileLink}\n🗓 <b>Время:</b> ${acceptedTime}`,
                { format: 'html' }
            );
        } catch (e) {
            console.error("Ошибка отправки уведомления о принятии:", e);
        }
        return;
    }

    // Перезапуск
    if (action === 'send_again_after_success' || action === 'restart_bot') {
        await initiateDialogStart(ctx, userId);
        return;
    }

    if (!stateObj) {
        await initiateDialogStart(ctx, userId);
        return;
    }

    // Переходы по кнопкам
    if (action === 'service_photo_estimate') {
        stateObj.inquiry_type = 'photo_estimate';
        stateObj.state = 'waiting_for_damage_description';
        saveUserState();
        await ctx.reply("🔒 Ваши фотографии и личные данные увидят только менеджеры нашего сервиса для расчета стоимости ремонта. Мы не передаем эту информацию третьим лицам");
        
        setTimeout(async () => {
            await ctx.reply("📝 Пожалуйста, опишите кратко, что нужно отремонтировать.", {
                attachments: [mainMenuKeyboard]
            });
        }, 500);
    } 
    else if (action === 'service_general_question') {
        stateObj.inquiry_type = 'general';
        stateObj.state = 'waiting_for_contact_method';
        saveUserState();
        const contactMethodMarkup = Keyboard.inlineKeyboard([
            [Keyboard.button.callback('✍️ Написать в MAX', 'contact_max')],
            [Keyboard.button.callback('📞 Позвонить по номеру', 'contact_phone')]
        ]);
        await ctx.reply("Выберите способ связи:", {
            attachments: [contactMethodMarkup]
        });
    }
    else if (action === 'contact_max' || action === 'contact_phone') {
        stateObj.contact_method = (action === 'contact_max') ? 'MAX' : 'Телефон';
        stateObj.state = 'waiting_for_phone';
        saveUserState();
        await ctx.reply("📱 Отлично! Теперь нужен Ваш номер телефона.", {
            attachments: [phoneRequestKeyboard]
        });
    }
    else if (action === 'photo_confirm_yes') {
        stateObj.state = 'waiting_for_contact_method';
        saveUserState();
        const contactMethodMarkup = Keyboard.inlineKeyboard([
            [Keyboard.button.callback('✍️ Написать в MAX', 'contact_max')],
            [Keyboard.button.callback('📞 Позвонить по номеру', 'contact_phone')]
        ]);
        await ctx.reply("Выберите способ связи:", {
            attachments: [contactMethodMarkup]
        });
    }
    else if (action === 'photo_confirm_replace') {
        stateObj.state = 'waiting_for_photo';
        stateObj.photoTokens = [];
        stateObj.photoPayloads = [];
        saveUserState();
        await ctx.reply("📸 Пожалуйста, загрузите все нужные фото заново.", {
            attachments: [mainMenuKeyboard]
        });
    }
    else if (action === 'photo_confirm_cancel') {
        stateObj.damage_description = null;
        stateObj.photoTokens = [];
        stateObj.state = null;
        saveUserState();
        await askInquiryType(ctx);
    }
    else if (action === 'change_phone_request') {
        stateObj.state = 'changing_phone';
        saveUserState();
        await ctx.reply("🔄 Введите новый номер телефона:", {
            attachments: [phoneRequestKeyboard]
        });
    }
    else if (action === 'manual_phone_input') {
        await ctx.reply("✍️ Введите номер как +7XXXXXXXXXX:", {
            attachments: [mainMenuKeyboard]
        });
    }
});

// --- Сборка и отправка заявки в группу менеджеров ---
async function sendDataToAdmin(ctx, userId) {
    const data = userState[userId];
    if (!data) return;

    const senderName = ctx.user.name || ctx.user.first_name || 'Пользователь';
    
    // Ссылка на профиль МАКС max://user/user_id
    const userProfileText = `🔗 <b>Профиль:</b> <a href="max://user/${userId}">${senderName}</a>`;

    const adminMarkup = Keyboard.inlineKeyboard([
        [Keyboard.button.callback('✅ Принять заявку', `accept_request_${userId}`)]
    ]);

    try {
        if (data.inquiry_type === 'photo_estimate') {
            const messageText = `‼️ <b>Заявка на оценку по фото</b>\n\n` +
                                `👤 <b>Имя:</b> ${data.name}\n` +
                                `📞 <b>Телефон:</b> ${data.phone}\n` +
                                `🗣 <b>Связь:</b> ${data.contact_method || 'не выбрано'}\n` +
                                `${userProfileText}\n\n` +
                                `📋 <b>Описание:</b>\n<i>${data.damage_description || ''}</i>`;

            // Фото — отдельным сообщением, чтобы кнопка не трогала их при редактировании
            const photoPayloads = data.photoPayloads || (data.photoTokens || []).map(t => ({ token: t }));
            const photoAttachments = photoPayloads.map(p => new ImageAttachment(p).toJson());
            await bot.api.sendMessageToChat(ADMIN_CHAT_ID, messageText, {
                attachments: photoAttachments,
                format: 'html'
            });

            // Текст с кнопкой — отдельным сообщением, его будем редактировать при принятии
            await bot.api.sendMessageToChat(ADMIN_CHAT_ID, `👆 Фото выше`, {
                attachments: [adminMarkup]
            });
        } else {
            const messageText = `✉️ <b>Новое сообщение (Общий вопрос)</b>\n\n` +
                                `👤 <b>Имя:</b> ${data.name}\n` +
                                `📞 <b>Телефон:</b> ${data.phone}\n` +
                                `🗣 <b>Связь:</b> ${data.contact_method || 'не выбрано'}\n` +
                                `${userProfileText}\n\n` +
                                `💬 <b>Сообщение:</b>\n<i>${data.final_message || ''}</i>`;

            await bot.api.sendMessageToChat(ADMIN_CHAT_ID, messageText, {
                attachments: [adminMarkup],
                format: 'html'
            });
        }

        // Подтверждение для пользователя
        const userSuccessMarkup = Keyboard.inlineKeyboard([
            [Keyboard.button.callback('📤 Отправить еще', 'send_again_after_success')]
        ]);

        const successMessage = `✅ <b>Ваша заявка успешно отправлена!</b>\n\n` +
                               `Наши менеджеры свяжутся с вами в ближайшее рабочее время.\n\n` +
                               `Мы работаем для вас:\n` +
                               `Пн-Вс | 09:00-20:00\n` +
                               `📍 г. Ростов-на-Дону, ул. Пескова 17/21\n\n` +
                               `Спасибо за обращение!`;

        await ctx.reply(successMessage, {
            attachments: [userSuccessMarkup],
            format: 'html'
        });

        clearPersonalData(userId); // удаляем личные данные, оставляем state='completed'

    } catch (error) {
        console.error("Ошибка при отправке админу:", error);
        await ctx.reply("⚠️ Произошла ошибка при отправке ваших данных. Попробуйте еще раз.");
    }
}

// --- Автоматическая регистрация команд при старте бота ---
async function startBot() {
    try {
        await bot.api.setMyCommands([
            { name: 'start', description: 'Перезапустить диалог с ботом' }
        ]);
        console.log("✅ Команды меню успешно зарегистрированы в МАКС!");
    } catch (e) {
        console.error("⚠️ Не удалось зарегистрировать команды меню:", e);
    }

    // Внутренний цикл переподключения — не трогаем процесс, просто
    // сбрасываем SDK-флаг через bot.stop() и запускаем polling заново.
    async function launchPolling() {
        while (true) {
            try {
                bot.stop(); // сбрасывает pollingIsStarted = false внутри SDK
            } catch (_) {}

            console.log("🚀 Бот АСТА-АВТО запущен, polling активен...");
            try {
                await bot.start();
                // Сюда попадаем если SDK сам вышел из loop (FetchError, 5xx и т.д.)
                console.warn("⚠️ Polling завершился, переподключение через 5 сек...");
            } catch (e) {
                console.error("⚠️ Ошибка polling, переподключение через 5 сек:", String(e?.message || e));
            }
            await new Promise(r => setTimeout(r, 5000));
        }
    }

    // В Node 15+ необработанный rejected promise завершает процесс —
    // перехватываем все, логируем, НЕ падаем (сетевые обрывы это норма).
    process.on('unhandledRejection', (reason) => {
        console.warn("⚠️ unhandledRejection (не критично):", String(reason?.message || reason));
    });

    process.on('uncaughtException', (err) => {
        console.error("💥 uncaughtException (критично):", err);
        process.exit(1);
    });

    cleanupStaleStates().catch(e => console.error("Ошибка очистки сессий:", e));
    setInterval(
        () => cleanupStaleStates().catch(e => console.error("Ошибка очистки сессий:", e)),
        60 * 60 * 1000 // каждый час
    );

    launchPolling();
}

startBot();